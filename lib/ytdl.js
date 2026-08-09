import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execPromise = promisify(exec)
const tmpDir = path.join(process.cwd(), 'tmp')

if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
}

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
]

const CLIENT_COMBOS = ['mweb,tv', 'ios,mweb', 'android,mweb']
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]

export async function downloadMedia(url, format = 'vn') {
    const timestamp = Date.now()
    const randomUA = getRandom(USER_AGENTS)
    const randomClient = getRandom(CLIENT_COMBOS)

    const antiBotFlags = [
        `--user-agent "${randomUA}"`,
        `--extractor-args "youtube:player_client=${randomClient}"`,
        '--no-warnings',
        '--no-check-certificates',
        '--geo-bypass',
        '--no-cache-dir',
        '--socket-timeout 30'
    ].join(' ')

    const rawPath = path.join(tmpDir, `raw_${timestamp}.opus`)
    const finalPath = path.join(tmpDir, `${timestamp}_converted.opus`)

    let command = ''

    if (format === 'vn' || format === 'mp3') {
        // 1. Descargar audio con yt-dlp
        command = `yt-dlp ${antiBotFlags} -f "bestaudio/best" --extract-audio --audio-format opus -o "${rawPath}" --no-playlist "${url}"`
    } else {
        // En caso de solicitar MP4
        const videoPath = path.join(tmpDir, `${timestamp}_video.mp4`)
        command = `yt-dlp ${antiBotFlags} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --recode-video mp4 -o "${videoPath}" --no-playlist "${url}"`
        await execPromise(command)
        
        return {
            filePath: videoPath,
            title: 'video',
            cleanup: () => { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath) }
        }
    }

    try {
        await execPromise(command)

        // 2. CONVERTIR CON FFMPEG AL FORMATO PTT DE WHATSAPP (OGG OPUS 48kHz Mono)
        const ffmpegCmd = `ffmpeg -y -i "${rawPath}" -c:a libopus -b:a 32k -vbr on -compression_level 10 -ar 48000 -ac 1 "${finalPath}"`
        await execPromise(ffmpegCmd)

        const cleanup = () => {
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath)
            if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath)
        }

        return {
            filePath: finalPath,
            title: 'audio',
            cleanup
        }
    } catch (error) {
        if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath)
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath)
        throw new Error(`Error procesando audio: ${error.message}`)
    }
}
