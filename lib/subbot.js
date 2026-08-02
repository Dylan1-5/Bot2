import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore, delay } from '@whiskeysockets/baileys'
import P from 'pino'
import fs from 'fs'
import path from 'path'
import { Boom } from '@hapi/boom'

// Guardaremos las conexiones activas de los sub bots en memoria
export const subBots = new Map()

const baseSubDir = path.join(process.cwd(), 'sub_sessions')

if (!fs.existsSync(baseSubDir)) {
    fs.mkdirSync(baseSubDir, { recursive: true })
}

/**
 * Inicia o vincula un sub bot
 */
export const startSubBot = async (parentConn, from, msg, phoneNumber) => {
    const cleanNumber = phoneNumber.replace(/\D/g, '')
    if (!cleanNumber || cleanNumber.length < 8) {
        return parentConn.sendMessage(from, { text: '《✧》 Ingrese un número de WhatsApp válido.\n> Ejemplo: /serbot 50612345678' }, { quoted: msg })
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
        browser: ["Windows", "Edge", "126.0.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: true
    })

    conn.ev.on('creds.update', saveCreds)

    // Si es nueva sesión, solicitamos el código de vinculación
    if (isNewSession && !conn.authState.creds.registered) {
        await parentConn.sendMessage(from, { text: `《✧》 Solicitando código de vinculación para +${cleanNumber}...` }, { quoted: msg })
        
        setTimeout(async () => {
            try {
                let code = await conn.requestPairingCode(cleanNumber)
                code = code.match(/.{1,4}/g)?.join("-") || code
                
                await parentConn.sendMessage(from, { 
                    text: `🔑 *CÓDIGO DE VINCULACIÓN DE SUB BOT*\n\nNúmero: +${cleanNumber}\nCódigo: *${code}*\n\n> Usa este código en *Dispositivos vinculados* en WhatsApp para conectar el sub bot.` 
                }, { quoted: msg })
            } catch (err) {
                await parentConn.sendMessage(from, { text: `❌ Error al solicitar el código: ${err.message}` }, { quoted: msg })
            }
        }, 2000)
    }

    // Escuchador de estado de conexión del Sub Bot
    conn.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect } = u

        if (connection === 'open') {
            const subBotJid = conn.user?.id?.split(':')[0] + '@s.whatsapp.net'
            subBots.set(cleanNumber, conn)
            
            await parentConn.sendMessage(from, { 
                text: `✅ *SUB BOT CONECTADO CON ÉXITO*\n\nEl número +${cleanNumber} ahora está funcionando como Sub Bot.` 
            })
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode
            subBots.delete(cleanNumber)

            if (reason !== DisconnectReason.loggedOut) {
                // Si la desconexión fue temporal, intenta reconectar
                startSubBot(parentConn, from, msg, cleanNumber)
            } else {
                // Si cerró sesión, eliminamos la carpeta de sesión
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true })
                }
            }
        }
    })

    return conn
}

/**
 * Carga todos los sub bots guardados al iniciar el bot principal
 */
export const loadAllSubBots = async (parentConn) => {
    if (!fs.existsSync(baseSubDir)) return

    const folders = fs.readdirSync(baseSubDir)
    for (const folder of folders) {
        const sessionPath = path.join(baseSubDir, folder)
        if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
            try {
                // Inicia el subbot silenciosamente
                await startSubBot(parentConn, null, null, folder)
            } catch (e) {
                console.error(`Error al recargar subbot ${folder}:`, e.message)
            }
        }
    }
}
