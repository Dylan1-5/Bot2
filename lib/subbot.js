import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import P from 'pino'
import fs from 'fs'
import path from 'path'
import { Boom } from '@hapi/boom'

export const subBots = new Map()
const baseSubDir = path.join(process.cwd(), 'sub_sessions')

if (!fs.existsSync(baseSubDir)) {
    fs.mkdirSync(baseSubDir, { recursive: true })
}

const retryTracker = new Map()

export const startSubBot = async (parentConn, from, msg, phoneNumber, handler) => {
    const cleanNumber = phoneNumber.replace(/\D/g, '')
    if (!cleanNumber || cleanNumber.length < 8) {
        if (parentConn && from) {
            return parentConn.sendMessage(from, { text: '《✧》 Ingrese un número de WhatsApp válido.' }, { quoted: msg })
        }
        return
    }

    const attempts = retryTracker.get(cleanNumber) || 0
    if (attempts >= 3) {
        console.log(`[SubBot] Límite de reintentos alcanzado para +${cleanNumber}.`)
        retryTracker.delete(cleanNumber)
        return
    }

    const sessionPath = path.join(baseSubDir, cleanNumber)
    const isNewSession = !fs.existsSync(path.join(sessionPath, 'creds.json'))

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
    const { version } = await fetchLatestBaileysVersion()

    const conn = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        markOnlineOnConnect: true
    })

    conn.ev.on('creds.update', saveCreds)

    // Solicitar código de vinculación
    if (isNewSession && !conn.authState.creds.registered) {
        if (parentConn && from) {
            await parentConn.sendMessage(from, { text: `《✧》 Solicitando código de vinculación para +${cleanNumber}...` }, { quoted: msg })
        }
        
        setTimeout(async () => {
            try {
                let code = await conn.requestPairingCode(cleanNumber)
                code = code.match(/.{1,4}/g)?.join("-") || code
                
                if (parentConn && from) {
                    // Mensaje 1: Explicación normal
                    await parentConn.sendMessage(from, { 
                        text: `🔑 *CÓDIGO DE VINCULACIÓN DE SUB BOT*\n\nNúmero: +${cleanNumber}\n\n_Usa este código en Dispositivos vinculados para conectar._` 
                    }, { quoted: msg })

                    // Mensaje 2: Código solo para fácil copia
                    await parentConn.sendMessage(from, { 
                        text: `${code}` 
                    })
                }
            } catch (err) {
                console.error(`[SubBot Error Code]:`, err.message)
                if (parentConn && from) {
                    await parentConn.sendMessage(from, { text: `❌ Error al generar código: ${err.message}` }, { quoted: msg })
                }
            }
        }, 3000)
    }

    // Escuchar mensajes entrantes para el Sub Bot
    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (handler && typeof handler === 'function') {
                await handler(conn, chatUpdate, { 
                    isSubBot: true, 
                    prefix: global.subprefix || ['.'] 
                })
            }
        } catch (err) {
            console.error(`[SubBot Message Error]:`, err)
        }
    })

    // Control de conexión y borrado automático al cerrar sesión
    conn.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect } = u

        if (connection === 'open') {
            retryTracker.delete(cleanNumber)
            subBots.set(cleanNumber, conn)
            console.log(`[SubBot] +${cleanNumber} listo y escuchando mensajes.`)
            
            if (parentConn && from) {
                await parentConn.sendMessage(from, { text: `✅ *SUB BOT CONECTADO CON ÉXITO*\n\nEl número +${cleanNumber} ahora está funcionando como Sub Bot.` })
            }
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            conn.ev.removeAllListeners()
            subBots.delete(cleanNumber)

            if (shouldReconnect) {
                retryTracker.set(cleanNumber, attempts + 1)
                console.log(`[SubBot] Reconectando +${cleanNumber}...`)
                setTimeout(() => startSubBot(parentConn, null, null, cleanNumber, handler), 5000)
            } else {
                // Borrado automático de la carpeta al cerrar sesión
                console.log(`[SubBot] Sesión de +${cleanNumber} cerrada permanentemente. Eliminando datos...`)
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true })
                    console.log(`[SubBot] Carpeta de sesión ${cleanNumber} eliminada correctamente.`)
                }
            }
        }
    })

    return conn
}

export const loadAllSubBots = async (parentConn, handler) => {
    if (!fs.existsSync(baseSubDir)) return
    const folders = fs.readdirSync(baseSubDir)
    for (const folder of folders) {
        const sessionPath = path.join(baseSubDir, folder)
        if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
            try {
                await startSubBot(parentConn, null, null, folder, handler)
            } catch (e) {
                console.error(`[SubBot Load Error]:`, e.message)
            }
        }
    }
}
