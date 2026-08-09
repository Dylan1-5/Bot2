import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execPromise = promisify(exec)
const tmpDir = path.join(process.cwd(), 'tmp')

if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
}

// User-Agents modernos para evitar bloqueos por cliente desactualizado
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
]

// Clientes vigentes en YouTube (se eliminó android_embedded y web directo)
const CLIENT_COMBOS = [
    'mweb,tv',
    'ios,mweb',
    'android,mweb',
    'tv,android',
    'mweb'
]

const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]

/**
 * Descarga audio o video de YouTube evadiendo bloqueos HTTP 429
 * @param {string} url - URL del video de YouTube
 * @param {'vn' | 'mp3' | 'mp4'} format - Formato deseado
 */
export async function downloadMedia(url, format = 'vn') {
    const timestamp = Date.now()
    let ext = 'opus'
    
    const randomUA = getRandom(USER_AGENTS)
    const randomClient = getRandom(CLIENT_COMBOS)

    // Banderas anti-bloqueo optimizadas
    const antiBotFlags = [
        `--user-agent "${randomUA}"`,
        `--extractor-args "youtube:player_client=${randomClient}"`,
        '--no-warnings',
        '--no-check-certificates',
        '--geo-bypass',
        '--no-cache-dir',
        '--socket-timeout 30',
        '--retries 5',
        '--fragment-retries 5'
    ].join(' ')

    let command = ''

    if (format === 'vn' || format === 'mp3') {
        ext = format === 'vn' ? 'opus' : 'mp3'
        // Extrae el mejor audio disponible y luego lo convierte al formato deseado
        command = `yt-dlp ${antiBotFlags} -f "bestaudio/best" --extract-audio --audio-format ${ext} --audio-quality 0 -o "${path.join(tmpDir, `${timestamp}_%(title)s.${ext}`)}" --no-playlist "${url}"`
    } else {
        ext = 'mp4'
        // Fusiona el mejor video e audio en MP4 o elige el mejor directo de 720p/1080p
        command = `yt-dlp ${antiBotFlags} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --recode-video mp4 -o "${path.join(tmpDir, `${timestamp}_%(title)s.${ext}`)}" --no-playlist "${url}"`
    }

    try {
        await execPromise(command)

        const files = fs.readdirSync(tmpDir)
        const downloadedFile = files.find(file => file.startsWith(`${timestamp}_`))

        if (!downloadedFile) {
            throw new Error('No se encontró el archivo procesado en la carpeta temporal.')
        }

        const fullPath = path.join(tmpDir, downloadedFile)
        const cleanTitle = downloadedFile.replace(`${timestamp}_`, '').replace(path.extname(downloadedFile), '')

        const cleanup = () => {
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath)
            }
        }

        return {
            filePath: fullPath,
            title: cleanTitle,
            cleanup
        }
    } catch (error) {
        throw new Error(`Error en la descarga: ${error.message}`)
    }
}
