import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFilePromise = promisify(execFile)
const tmpDir = path.join(process.cwd(), 'tmp')

if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
}

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
]

// YouTube puede fallar con un cliente específico; se prueban en orden.
const CLIENT_COMBOS = ['android', 'web_safari', 'ios,mweb', 'mweb,tv']
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]
const isFile = (value) => value && fs.existsSync(value) && fs.statSync(value).isFile()

let ytDlpRunner = null
let ffmpegPath = null

async function canRun(command, args = ['--version']) {
    try {
        await execFilePromise(command, args, { timeout: 10000, windowsHide: true })
        return true
    } catch {
        return false
    }
}

async function resolveYtDlp() {
    if (ytDlpRunner) return ytDlpRunner

    const prefix = process.env.PREFIX || '/data/data/com.termux/files/usr'
    const directCandidates = [
        process.env.YTDLP_PATH,
        path.join(prefix, 'bin', 'yt-dlp'),
        path.join(process.env.HOME || '', '.local', 'bin', 'yt-dlp'),
        'yt-dlp'
    ].filter(Boolean)

    for (const candidate of directCandidates) {
        if ((candidate.includes(path.sep) && !isFile(candidate)) || !(await canRun(candidate))) continue
        ytDlpRunner = (args) => execFilePromise(candidate, args, {
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true
        })
        return ytDlpRunner
    }

    // Permite usar yt-dlp instalado como módulo de Python en Termux.
    for (const python of ['python3', 'python']) {
        if (!(await canRun(python, ['-m', 'yt_dlp', '--version']))) continue
        ytDlpRunner = (args) => execFilePromise(python, ['-m', 'yt_dlp', ...args], {
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true
        })
        return ytDlpRunner
    }

    throw new Error(
        'yt-dlp no está instalado o no está en el PATH. En Termux ejecutá: pkg install python ffmpeg && python -m pip install -U yt-dlp'
    )
}

async function resolveFfmpeg() {
    if (ffmpegPath) return ffmpegPath

    const prefix = process.env.PREFIX || '/data/data/com.termux/files/usr'
    const candidates = [
        process.env.FFMPEG_PATH,
        path.join(prefix, 'bin', 'ffmpeg'),
        'ffmpeg'
    ].filter(Boolean)

    for (const candidate of candidates) {
        if ((candidate.includes(path.sep) && !isFile(candidate)) || !(await canRun(candidate))) continue
        ffmpegPath = candidate
        return ffmpegPath
    }

    throw new Error(
        'ffmpeg no está instalado o no está en el PATH. En Termux ejecutá: pkg install ffmpeg'
    )
}

async function runFfmpeg(args) {
    const command = await resolveFfmpeg()
    return execFilePromise(command, args, {
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
    })
}

function removeFilesWithTimestamp(timestamp) {
    for (const file of fs.readdirSync(tmpDir)) {
        if (!file.includes(String(timestamp))) continue
        try {
            fs.rmSync(path.join(tmpDir, file), { force: true })
        } catch {}
    }
}

async function runYtDlpWithFallback(runYtDlp, commonArgs, specificArgs, url) {
    let lastError

    for (const client of CLIENT_COMBOS) {
        try {
            return await runYtDlp([
                ...commonArgs,
                '--extractor-args', `youtube:player_client=${client}`,
                ...specificArgs,
                url
            ])
        } catch (error) {
            lastError = error
            console.warn(`[yt-dlp] Cliente ${client} falló: ${error.message}`)
        }
    }

    throw lastError || new Error('No se pudo descargar el enlace con ningún cliente de YouTube.')
}

export async function downloadMedia(url, format = 'vn') {
    if (!url || typeof url !== 'string') {
        throw new Error('No se recibió un enlace válido.')
    }

    const timestamp = Date.now()
    const randomUA = getRandom(USER_AGENTS)
    const rawTemplate = path.join(tmpDir, `raw_${timestamp}.%(ext)s`)

    const commonArgs = [
        '--user-agent', randomUA,
        '--no-warnings',
        '--force-ipv4',
        '--no-check-certificates',
        '--geo-bypass',
        '--no-cache-dir',
        '--socket-timeout', '15',
        '--concurrent-fragments', '4',
        '--buffer-size', '16k',
        '--no-playlist'
    ]

    try {
        const runYtDlp = await resolveYtDlp()

        if (format === 'vn' || format === 'mp3') {
            const finalPath = path.join(tmpDir, `${timestamp}_${format === 'mp3' ? 'mp3' : 'vn'}.opus`)
            await runYtDlpWithFallback(runYtDlp, commonArgs, [
                // Algunos clientes de YouTube no exponen webm/m4a; usar cualquier audio disponible.
                '-f', 'bestaudio/best',
                '-o', rawTemplate
            ], url)

            const downloadedRaw = fs.readdirSync(tmpDir).find(file => file.startsWith(`raw_${timestamp}.`))
            if (!downloadedRaw) throw new Error('No se encontró el audio descargado.')

            const rawPath = path.join(tmpDir, downloadedRaw)
            await runFfmpeg([
                '-y', '-i', rawPath,
                '-c:a', 'libopus',
                '-b:a', format === 'mp3' ? '128k' : '32k',
                '-vbr', 'on',
                '-compression_level', '0',
                '-threads', '0',
                '-ar', '48000',
                '-ac', '1',
                finalPath
            ])

            fs.rmSync(rawPath, { force: true })

            return {
                filePath: finalPath,
                title: 'Audio',
                cleanup: () => fs.rmSync(finalPath, { force: true })
            }
        }

        const videoPath = path.join(tmpDir, `${timestamp}_video.mp4`)
        await runYtDlpWithFallback(runYtDlp, commonArgs, [
            // No limitar extensiones: la disponibilidad cambia según el cliente.
            '-f', 'bestvideo*+bestaudio/best',
            '--merge-output-format', 'mp4',
            '-o', videoPath
        ], url)

        return {
            filePath: videoPath,
            title: 'Video',
            cleanup: () => fs.rmSync(videoPath, { force: true })
        }
    } catch (error) {
        removeFilesWithTimestamp(timestamp)

        if (error.message?.includes('DRM protected')) {
            throw new Error('Esta canción tiene protección DRM y no se puede descargar.')
        }

        throw new Error(`Error en descarga: ${error.message}`)
    }
}
