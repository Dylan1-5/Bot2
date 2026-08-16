import { jidDecode } from '@whiskeysockets/baileys'

const lidCache = new Map()

export const normalizeJid = (raw) => {
    if (!raw) return ''
    const value = String(raw).trim()
    if (!value) return ''

    if (value.includes('@')) {
        if (/^\d+:\d+@/i.test(value)) {
            const decoded = jidDecode(value) || {}
            if (decoded.user && decoded.server) return `${decoded.user}@${decoded.server}`
        }
        return value
    }

    const digits = value.replace(/\D/g, '')
    return digits ? `${digits}@s.whatsapp.net` : value
}

export const extractNumber = (value) => {
    if (!value || typeof value !== 'string') return ''
    if (/@lid(?:$|:)/i.test(value)) return ''

    const number = value.split('@')[0].split(':')[0].replace(/\D/g, '')
    return /^\d{8,15}$/.test(number) ? number : ''
}

export const normalizePhoneJid = (value) => extractNumber(value)

export const getContextInfo = (msg) => {
    const type = Object.keys(msg?.message || {})[0]
    return msg?.message?.extendedTextMessage?.contextInfo
        || msg?.message?.[type]?.contextInfo
        || {}
}

export const getMentionedJids = (msg) => getContextInfo(msg).mentionedJid || []

export const resolveJidAsync = async (raw, conn, groupJid = '') => {
    const normalized = normalizeJid(raw)
    if (!normalized || !normalized.endsWith('@lid')) return normalized

    if (lidCache.has(normalized)) return lidCache.get(normalized)

    const mapping = conn?.signalRepository?.lidMapping
    if (mapping?.getPNForLID) {
        try {
            const number = extractNumber(await mapping.getPNForLID(normalized))
            if (number) {
                const jid = `${number}@s.whatsapp.net`
                lidCache.set(normalized, jid)
                return jid
            }
        } catch {}
    }

    if (typeof conn?.findJidByLid === 'function') {
        try {
            const number = extractNumber(await conn.findJidByLid(normalized))
            if (number) {
                const jid = `${number}@s.whatsapp.net`
                lidCache.set(normalized, jid)
                return jid
            }
        } catch {}
    }

    if (groupJid?.endsWith('@g.us') && typeof conn?.groupMetadata === 'function') {
        try {
            const metadata = await conn.groupMetadata(groupJid)
            const lidBase = normalized.split('@')[0]

            for (const participant of metadata?.participants || []) {
                const participantLid = participant.lid || participant.id
                if (!participantLid?.endsWith('@lid')) continue
                if (participantLid.split('@')[0] !== lidBase) continue

                const number = extractNumber(participant.phoneNumber || participant.jid)
                if (number) {
                    const jid = `${number}@s.whatsapp.net`
                    lidCache.set(normalized, jid)
                    return jid
                }
            }
        } catch (error) {
            console.error('[Numberextractor] No se pudo resolver el LID:', error.message)
        }
    }

    return normalized
}

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

    const rawSender = key.fromMe ? conn?.user?.id : key.participant || key.remoteJid
    return extractNumber(await resolveJidAsync(rawSender, conn, key.remoteJid))
}

export const resolveMentionedPhone = async (conn, msg, mentionedJid) => {
    if (!mentionedJid) return ''
    return extractNumber(await resolveJidAsync(mentionedJid, conn, msg?.key?.remoteJid))
}

// Serializador mínimo: crea msg.sender como el otro bot.
export const smsg = async (conn, msg) => {
    if (!msg) return msg

    msg.chat = msg.key?.remoteJid
    msg.fromMe = msg.key?.fromMe

    const rawSender = msg.fromMe
        ? conn?.user?.id
        : msg.key?.participant || msg.key?.remoteJid

    msg.sender = await resolveJidAsync(rawSender, conn, msg.key?.remoteJid)
    return msg
}
