import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execPromise = promisify(exec)
const tmpDir = path.join(process.cwd(), 'tmp')

if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
}

/**
 * Descarga audio (como nota de voz) o video de YouTube localmente
 * @param {string} url - URL del video de YouTube
 * @param {'vn' | 'mp3' | 'mp4'} format - Formato deseado
 */
export async function downloadMedia(url, format = 'vn') {
    const timestamp = Date.now()
    let ext = 'opus'
    let command = ''

    // Parámetros anti-bloqueo y bypass de verificación bot para YouTube
    const antiBotFlags = `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --extractor-args "youtube:player_client=android,web"`

    if (format === 'vn' || format === 'mp3') {
        ext = format === 'vn' ? 'opus' : 'mp3'
        command = `yt-dlp ${antiBotFlags} --extract-audio --audio-format ${ext} --audio-quality 0 -o "${path.join(tmpDir, `${timestamp}_%(title)s.${ext}`)}" --no-playlist "${url}"`
    } else {
        ext = 'mp4'
        command = `yt-dlp ${antiBotFlags} -f "b[ext=mp4]/k" -o "${path.join(tmpDir, `${timestamp}_%(title)s.${ext}`)}" --no-playlist "${url}"`
    }

    try {
        await execPromise(command)

        const files = fs.readdirSync(tmpDir)
        const downloadedFile = files.find(file => file.startsWith(`${timestamp}_`))

        if (!downloadedFile) {
            throw new Error('No se encontró el archivo procesado en la carpeta temporal.')
        }

        const fullPath = path.join(tmpDir, downloadedFile)
        const cleanTitle = downloadedFile.replace(`${timestamp}_`, '').replace(`.${ext}`, '')

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
