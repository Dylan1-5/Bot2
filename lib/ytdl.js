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
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
]

const CLIENT_COMBOS = ['mweb,tv', 'ios,mweb', 'android']
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]

export async function downloadMedia(url, format = 'vn') {
    const timestamp = Date.now()
    const randomUA = getRandom(USER_AGENTS)
    const randomClient = getRandom(CLIENT_COMBOS)

    // Banderas optimizadas para máxima velocidad de descarga y menor uso de CPU
    const speedFlags = [
        `--user-agent "${randomUA}"`,
        `--extractor-args "youtube:player_client=${randomClient}"`,
        '--no-warnings',
        '--no-check-certificates',
        '--geo-bypass',
        '--no-cache-dir',
        '--socket-timeout 10',
        '--concurrent-fragments 4', // Descarga hasta 4 fragmentos simultáneamente
        '--buffer-size 16k'
    ].join(' ')

    const rawTemplate = path.join(tmpDir, `raw_${timestamp}.%(ext)s`)
    const finalPath = path.join(tmpDir, `${timestamp}_vn.opus`)

    if (format === 'vn' || format === 'mp3') {
        // Priorizar formatos Opus/WebM ligeros de YouTube para reducir trabajo de conversión
        const downloadCmd = `yt-dlp ${speedFlags} -f "ba[ext=webm]/ba[ext=m4a]/ba/b" -o "${rawTemplate}" --no-playlist "${url}"`
        
        try {
            await execPromise(downloadCmd)

            const files = fs.readdirSync(tmpDir)
            const downloadedRaw = files.find(f => f.startsWith(`raw_${timestamp}`))

            if (!downloadedRaw) {
                throw new Error('No se pudo encontrar el archivo procesado.')
            }

            const rawPath = path.join(tmpDir, downloadedRaw)

            // Conversión ultrarrápida con hilos optimizados para procesadores ARM de móviles
            const ffmpegCmd = `ffmpeg -y -i "${rawPath}" -c:a libopus -b:a 32k -vbr on -compression_level 0 -threads 0 -ar 48000 -ac 1 "${finalPath}"`
            await execPromise(ffmpegCmd)

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
            const files = fs.readdirSync(tmpDir)
            files.filter(f => f.includes(`${timestamp}`)).forEach(f => fs.unlinkSync(path.join(tmpDir, f)))

            if (error.message.includes('DRM protected')) {
                throw new Error('Esta canción tiene protección DRM y no se puede descargar.')
            }
            throw new Error(`Error en descarga rápida: ${error.message}`)
        }
    } else {
        const videoPath = path.join(tmpDir, `${timestamp}_video.mp4`)
        const videoCmd = `yt-dlp ${speedFlags} -f "b[ext=mp4]/best" -o "${videoPath}" --no-playlist "${url}"`
        
        await execPromise(videoCmd)
        
        return {
            filePath: videoPath,
            title: 'Video',
            cleanup: () => { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath) }
        }
    }
}
