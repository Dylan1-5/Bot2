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

    // Usamos una plantilla de archivo temporal genérica para la descarga base
    const rawTemplate = path.join(tmpDir, `raw_${timestamp}.%(ext)s`)
    const finalPath = path.join(tmpDir, `${timestamp}_vn.opus`)

    if (format === 'vn' || format === 'mp3') {
        const downloadCmd = `yt-dlp ${antiBotFlags} -f "bestaudio/best" -o "${rawTemplate}" --no-playlist "${url}"`
        
        try {
            await execPromise(downloadCmd)

            // Buscamos el archivo real que descargó yt-dlp
            const files = fs.readdirSync(tmpDir)
            const downloadedRaw = files.find(f => f.startsWith(`raw_${timestamp}`))

            if (!downloadedRaw) {
                throw new Error('No se pudo encontrar el archivo descargado por yt-dlp.')
            }

            const rawPath = path.join(tmpDir, downloadedRaw)

            // Conversión estricta a OGG/Opus compatible con notas de voz de WhatsApp (48kHz Mono)
            const ffmpegCmd = `ffmpeg -y -i "${rawPath}" -c:a libopus -b:a 32k -vbr on -compression_level 10 -ar 48000 -ac 1 "${finalPath}"`
            await execPromise(ffmpegCmd)

            // Limpieza del archivo descargado original
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath)

            const cleanup = () => {
                if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath)
            }

            return {
                filePath: finalPath,
                title: 'Audio',
                cleanup
            }
        } catch (error) {
            // Limpieza en caso de falla
            const files = fs.readdirSync(tmpDir)
            files.filter(f => f.includes(`${timestamp}`)).forEach(f => fs.unlinkSync(path.join(tmpDir, f)))

            if (error.message.includes('DRM protected')) {
                throw new Error('Esta canción tiene protección de derechos de autor (DRM) y no se puede descargar.')
            }
            throw new Error(`Error procesando audio: ${error.message}`)
        }
    } else {
        const videoPath = path.join(tmpDir, `${timestamp}_video.mp4`)
        const videoCmd = `yt-dlp ${antiBotFlags} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --recode-video mp4 -o "${videoPath}" --no-playlist "${url}"`
        
        await execPromise(videoCmd)
        
        return {
            filePath: videoPath,
            title: 'Video',
            cleanup: () => { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath) }
        }
    }
}
