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
 * Descarga audio (como nota de voz/opus) o video de YouTube localmente
 * @param {string} url - URL del video de YouTube
 * @param {'vn' | 'mp3' | 'mp4'} format - Formato deseado ('vn' para Voice Note / Nota de voz)
 * @returns {Promise<{ filePath: string, title: string, cleanup: Function }>}
 */
export async function downloadMedia(url, format = 'vn') {
    const timestamp = Date.now()
    let ext = 'opus'
    let command = ''

    if (format === 'vn' || format === 'mp3') {
        ext = format === 'vn' ? 'opus' : 'mp3'
        const codec = format === 'vn' ? 'libopus' : 'mp3'
        // Extrae el audio y lo convierte al formato deseado usando ffmpeg
        command = `yt-dlp --extract-audio --audio-format ${ext} --audio-quality 0 -o "${path.join(tmpDir, `${timestamp}_%(title)s.${ext}`)}" --no-playlist "${url}"`
    } else {
        ext = 'mp4'
        command = `yt-dlp -f "b[ext=mp4]/k" -o "${path.join(tmpDir, `${timestamp}_%(title)s.${ext}`)}" --no-playlist "${url}"`
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
