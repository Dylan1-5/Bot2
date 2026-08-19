import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import yts from 'yt-search'

const execFilePromise = promisify(execFile)
const tmpDir = path.join(process.cwd(), 'tmp')
const prefix = process.env.PREFIX || '/data/data/com.termux/files/usr'
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36'
]
const CLIENTS = ['android', 'web_safari', 'ios,mweb', 'mweb,tv']
let ytDlpRunner = null
let ffmpegRunner = null

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

const randomItem = list => list[Math.floor(Math.random() * list.length)]
const existsFile = value => value && fs.existsSync(value) && fs.statSync(value).isFile()
const remove = file => { try { fs.rmSync(file, { force: true }) } catch {} }

const canRun = async (command, args = ['--version']) => {
    try {
        await execFilePromise(command, args, { timeout: 10000, windowsHide: true })
        return true
    } catch {
        return false
    }
}

const resolveYtDlp = async () => {
    if (ytDlpRunner) return ytDlpRunner

    const candidates = [
        process.env.YTDLP_PATH,
        path.join(prefix, 'bin', 'yt-dlp'),
        path.join(process.env.HOME || '', '.local', 'bin', 'yt-dlp'),
        'yt-dlp'
    ].filter(Boolean)

    for (const candidate of candidates) {
        if (candidate.includes(path.sep) ? !existsFile(candidate) : !(await canRun(candidate))) continue
        ytDlpRunner = args => execFilePromise(candidate, args, {
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true
        })
        return ytDlpRunner
    }

    for (const python of ['python3', 'python']) {
        if (!(await canRun(python, ['-m', 'yt_dlp', '--version']))) continue
        ytDlpRunner = args => execFilePromise(python, ['-m', 'yt_dlp', ...args], {
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true
        })
        return ytDlpRunner
    }

    throw new Error('YT-DLP_NO_INSTALADO')
}

const resolveFfmpeg = async () => {
    if (ffmpegRunner) return ffmpegRunner

    const candidates = [process.env.FFMPEG_PATH, path.join(prefix, 'bin', 'ffmpeg'), 'ffmpeg'].filter(Boolean)
    for (const candidate of candidates) {
        if (candidate.includes(path.sep) ? !existsFile(candidate) : !(await canRun(candidate))) continue
        ffmpegRunner = args => execFilePromise(candidate, args, {
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true
        })
        return ffmpegRunner
    }

    throw new Error('FFMPEG_NO_INSTALADO')
}

const removeTimestampFiles = timestamp => {
    for (const file of fs.readdirSync(tmpDir)) {
        if (file.includes(String(timestamp))) remove(path.join(tmpDir, file))
    }
}

const runWithClients = async (runYtDlp, commonArgs, specificArgs, url) => {
    let lastError
    for (const client of CLIENTS) {
        try {
            return await runYtDlp([
                ...commonArgs,
                '--extractor-args', `youtube:player_client=${client}`,
                ...specificArgs,
                url
            ])
        } catch (error) {
            lastError = error
        }
    }
    throw lastError || new Error('DOWNLOAD_FAILED')
}

const friendlyError = error => {
    const message = String(error?.message || error || '')
    if (message.includes('Sign in to confirm your age')) return 'Este video requiere verificación de edad.'
    if (message.includes('DRM protected')) return 'Este contenido está protegido.'
    if (message.includes('YT-DLP_NO_INSTALADO')) return 'yt-dlp no está instalado.'
    if (message.includes('FFMPEG_NO_INSTALADO')) return 'ffmpeg no está instalado.'
    return 'No se pudo descargar el contenido.'
}

export async function downloadMedia(url, format = 'vn') {
    if (!url || typeof url !== 'string') throw new Error('El enlace no es válido.')

    const timestamp = Date.now()
    const rawTemplate = path.join(tmpDir, `raw_${timestamp}.%(ext)s`)
    const randomUA = randomItem(USER_AGENTS)
    const commonArgs = [
        '--user-agent', randomUA,
        '--no-warnings', '--force-ipv4', '--no-check-certificates', '--geo-bypass',
        '--no-cache-dir', '--socket-timeout', '15', '--concurrent-fragments', '8',
        '--retries', '2', '--fragment-retries', '2', '--buffer-size', '16k', '--no-playlist'
    ]

    try {
        const runYtDlp = await resolveYtDlp()
        const runFfmpeg = await resolveFfmpeg()

        if (format === 'vn' || format === 'mp3') {
            const isMp3 = format === 'mp3'
            const finalPath = path.join(tmpDir, `${timestamp}_${isMp3 ? 'mp3' : 'vn'}.${isMp3 ? 'mp3' : 'ogg'}`)

            await runWithClients(runYtDlp, commonArgs, ['-f', 'bestaudio/best', '-o', rawTemplate], url)
            const rawName = fs.readdirSync(tmpDir).find(file => file.startsWith(`raw_${timestamp}.`))
            if (!rawName) throw new Error('AUDIO_NOT_FOUND')
            const rawPath = path.join(tmpDir, rawName)

            const ffmpegArgs = isMp3
                ? ['-y', '-i', rawPath, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-f', 'mp3', finalPath]
                : ['-y', '-i', rawPath, '-vn', '-map', '0:a:0', '-c:a', 'libopus', '-b:a', '160k', '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-frame_duration', '20', '-ar', '48000', '-ac', '2', '-map_metadata', '-1', '-avoid_negative_ts', 'make_zero', '-f', 'ogg', finalPath]

            await runFfmpeg(ffmpegArgs)
            remove(rawPath)
            if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1000) throw new Error('AUDIO_INVALIDO')

            return {
                filePath: finalPath,
                title: 'Audio',
                cleanup: () => remove(finalPath)
            }
        }

        const videoPath = path.join(tmpDir, `${timestamp}_video.mp4`)
        await runWithClients(runYtDlp, commonArgs, [
            '-f', 'bestvideo*+bestaudio/best',
            '--merge-output-format', 'mp4',
            '-o', videoPath
        ], url)

        return {
            filePath: videoPath,
            title: 'Video',
            cleanup: () => remove(videoPath)
        }
    } catch (error) {
        removeTimestampFiles(timestamp)
        throw new Error(friendlyError(error))
    }
}

export async function downloadFromSearch(query, format = 'vn') {
    if (!query || typeof query !== 'string') throw new Error('No se recibió una búsqueda válida.')

    const queries = /\bletra\b/i.test(query) ? [query] : [query, `${query} letra`]
    const attempted = new Set()
    let lastError = null

    for (const searchQuery of queries) {
        const result = await yts({ query: searchQuery }).catch(() => null)
        for (const video of (result?.videos || []).slice(0, 3)) {
            if (!video?.url || attempted.has(video.url)) continue
            attempted.add(video.url)
            try {
                return { video, ...(await downloadMedia(video.url, format)), searchQuery }
            } catch (error) {
                lastError = error
            }
        }
    }

    throw lastError || new Error('No se pudo descargar ningún resultado.')
}
