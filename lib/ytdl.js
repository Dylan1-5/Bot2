import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execPromise = promisify(exec)
const tmpDir = path.join(process.cwd(), 'tmp')

if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
}

// Lista de User-Agents reales para rotar en cada descarga
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'
]

// Lista de combinaciones de clientes de YouTube
const CLIENT_COMBOS = [
    'android,web',
    'ios,web',
    'mweb,android',
    'web,android_embedded',
    'android'
]

// Función auxiliar para obtener un elemento aleatorio
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]

/**
 * Descarga audio o video de YouTube con múltiples barreras de evasión de bloqueos
 * @param {string} url - URL del video de YouTube
 * @param {'vn' | 'mp3' | 'mp4'} format - Formato deseado
 */
export async function downloadMedia(url, format = 'vn') {
    const timestamp = Date.now()
    let ext = 'opus'
    
    // 1. Selección aleatoria de huella digital
    const randomUA = getRandom(USER_AGENTS)
    const randomClient = getRandom(CLIENT_COMBOS)

    // 2. Construcción del conjunto de barreras anti-bot y anti-rate-limit
    const antiBotFlags = [
        `--user-agent "${randomUA}"`,
        `--extractor-args "youtube:player_client=${randomClient}"`,
        '--retries 10',                  // Reintentar hasta 10 veces si hay fallo de red
        '--fragment-retries 10',         // Reintentar fragmentos fallidos
        '--retry-sleep 3',               // Esperar 3 segundos entre reintentos
        '--no-check-certificates',       // Ignorar errores de certificado
        '--geo-bypass',                  // Evitar bloqueos por región
        '--rm-cache-dir',                // Limpiar caché interna en cada petición
        '--socket-timeout 30'            // Tiempo límite de respuesta por socket
    ].join(' ')

    let command = ''

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
