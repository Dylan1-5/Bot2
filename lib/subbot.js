import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import P from 'pino'
import fs from 'fs'
import path from 'path'
import { Boom } from '@hapi/boom'

export const subBots = new Map()
export const subBotOwners = new Map()

const baseSubDir = path.join(process.cwd(), 'sub_sessions')

if (!fs.existsSync(baseSubDir)) {
    fs.mkdirSync(baseSubDir, { recursive: true })
}

const retryTracker = new Map()
const lidCache = new Map()

// Limpieza y normalizaci贸n de n煤mero desde el ID/menci贸n recibido
export const extractNumber = (input) => {
    if (!input || typeof input !== 'string') return ''

    // Nunca convertir un LID de WhatsApp en un n煤mero telef贸nico.
    if (/@lid(?:$|:)/i.test(input)) return ''

    let target = input.split('@')[0].split(':')[0]
    let clean = target.replace(/\D/g, '')
    if (clean.startsWith('0')) clean = clean.replace(/^0+/, '')
    if (clean.length === 10 && clean.startsWith('3')) clean = '57' + clean
    if (clean.startsWith('52') && !clean.startsWith('521') && clean.length >= 12) clean = '521' + clean.slice(2)
    if (clean.startsWith('54') && !clean.startsWith('549') && clean.length >= 11) clean = '549' + clean.slice(2)

    return /^\d{8,15}$/.test(clean) ? clean : ''
}

// Resuelve autom谩ticamente el tel茅fono del usuario que ejecut贸 el comando.
// Toda la l贸gica LID queda centralizada en este archivo.
export const resolvePhoneFromMessage = async (conn, msg) => {
    const key = msg?.key || {}
    const candidates = [
        msg?.sender,
        key.senderPn,
        key.participantPn,
        key.participantAlt,
        key.remoteJidAlt,
        key.participant,
        key.remoteJid
    ]

    for (const candidate of candidates) {
        const number = extractNumber(candidate)
        if (number) return number
    }

    const lid = candidates.find(value =>
        typeof value === 'string' && /@lid(?:$|:)/i.test(value)
    )

    if (!lid) return ''
    if (lidCache.has(lid)) return lidCache.get(lid)

    const mapping = conn?.signalRepository?.lidMapping
    if (mapping?.getPNForLID) {
        try {
            const number = extractNumber(await mapping.getPNForLID(lid))
            if (number) {
                lidCache.set(lid, number)
                return number
            }
        } catch {}
    }

    if (typeof conn?.findJidByLid === 'function') {
        try {
            const number = extractNumber(await conn.findJidByLid(lid))
            if (number) {
                lidCache.set(lid, number)
                return number
            }
        } catch {}
    }

    const groupJid = msg?.key?.remoteJid
    if (groupJid?.endsWith('@g.us') && typeof conn?.groupMetadata === 'function') {
        try {
            const metadata = await conn.groupMetadata(groupJid)
            const lidBase = lid.split('@')[0]

            for (const participant of metadata?.participants || []) {
                const participantLid = participant.lid || participant.id
                if (!participantLid?.endsWith('@lid')) continue
                if (participantLid.split('@')[0] !== lidBase) continue

                const number = extractNumber(participant.phoneNumber || participant.jid)
                if (number) {
                    lidCache.set(lid, number)
                    return number
                }
            }
        } catch (error) {
            console.error('[SubBot LID] No se pudo resolver:', error.message)
        }
    }

    return ''
}

export const startSubBot = async (parentConn, from, msg, phoneNumber, handler) => {
    const cleanNumber = extractNumber(phoneNumber)
    if (!cleanNumber || cleanNumber.length < 8) {
        if (parentConn && from) {
            return parentConn.sendMessage(from, { text: '銆娾湩銆� Ingrese un n煤mero de WhatsApp v谩lido.' }, { quoted: msg })
        }
        return
    }

    // Si la sesi贸n no tiene un due帽o asignado, el primer due帽o es el propio n煤mero
    if (!subBotOwners.has(cleanNumber)) {
        subBotOwners.set(cleanNumber, cleanNumber)
    }

    const attempts = retryTracker.get(cleanNumber) || 0
    if (attempts >= 3) {
        console.log(`[SubBot] L铆mite de reintentos alcanzado para +${cleanNumber}.`)
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
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000,
        markOnlineOnConnect: true
    })

    conn.ev.on('creds.update', saveCreds)

    // Solicitar c贸digo de vinculaci贸n
    if (isNewSession && !state.creds.registered) {
        if (parentConn && from) {
            await parentConn.sendMessage(from, { text: `銆娾湩銆� Solicitando c贸digo de vinculaci贸n para +${cleanNumber}...` }, { quoted: msg })
        }
        
        setTimeout(async () => {
            try {
                let code = await conn.requestPairingCode(cleanNumber)
                code = code.match(/.{1,4}/g)?.join("-") || code
                
                if (parentConn && from) {
                    await parentConn.sendMessage(from, { 
                        text: `馃攽 *C脫DIGO DE VINCULACI脫N DE SUB BOT*\n\nN煤mero: +${cleanNumber}\n\n_Usa este c贸digo en Dispositivos vinculados para conectar._` 
                    }, { quoted: msg })

                    await parentConn.sendMessage(from, { 
                        text: `${code}` 
                    })
                }
            } catch (err) {
                console.error(`[SubBot Error Code]:`, err.message)
                if (parentConn && from) {
                    await parentConn.sendMessage(from, { text: `鉂� Error al generar c贸digo: ${err.message}` }, { quoted: msg })
                }
            }
        }, 3000)
    }

    // Escuchar mensajes entrantes para el Sub Bot
    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (!handler || typeof handler !== 'function') return

            for (const message of chatUpdate.messages || []) {
                await handler(conn, { messages: [message] }, {
                    isSubBot: true,
                    prefix: global.subprefix || ['.']
                })
            }
        } catch (err) {
            console.error(`[SubBot Message Error]:`, err)
        }
    })

    // Control de conexi贸n y borrado autom谩tico al cerrar sesi贸n
    conn.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect } = u

        if (connection === 'open') {
            retryTracker.delete(cleanNumber)
            subBots.set(cleanNumber, conn)
            console.log(`[SubBot] +${cleanNumber} listo y escuchando mensajes.`)
            
            if (parentConn && from) {
                await parentConn.sendMessage(from, { text: `鉁� *SUB BOT CONECTADO CON 脡XITO*\n\nEl n煤mero +${cleanNumber} ahora est谩 funcionando como Sub Bot.` })
            }
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
            console.log(`[SubBot] Conexi贸n cerrada para +${cleanNumber}. C贸digo: ${statusCode || 'sin c贸digo'}`)
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            conn.ev.removeAllListeners()
            subBots.delete(cleanNumber)

            if (shouldReconnect) {
                retryTracker.set(cleanNumber, attempts + 1)
                console.log(`[SubBot] Reconectando +${cleanNumber}...`)
                setTimeout(() => startSubBot(parentConn, null, null, cleanNumber, handler), 5000)
            } else {
                console.log(`[SubBot] Sesi贸n de +${cleanNumber} cerrada permanentemente. Eliminando datos...`)
                subBotOwners.delete(cleanNumber)
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true })
                    console.log(`[SubBot] Carpeta de sesi贸n ${cleanNumber} eliminada correctamente.`)
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
