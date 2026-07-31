// lib/kick.js
import { delay } from '@whiskeysockets/baileys'

export const handleKick = async (conn, from, msg, args, participants, groupMetadata, usedPrefix, command) => {
    // Variables principales
    const ownerGroup = groupMetadata?.owner || from.split('-')[0] + '@s.whatsapp.net'
    const ownerBot = (global.owner?.[0]?.[0] || '') + '@s.whatsapp.net'
    const botId = String(conn.user?.id || '').split(':')[0] + '@s.whatsapp.net'

    // Función rápida para responder
    const reply = async (text) => {
        return conn.sendMessage(from, { text }, { quoted: msg })
    }

    // 1. SACAR POR PREFIJO DE PAÍS (num / listnum)
    if (args[0] === 'num' || args[0] === 'listnum') {
        if (!args[1]) return reply(`《✧》 Ingrese algún prefijo de un país\n> ✎ Ejemplo: *${usedPrefix || '/'}${command} num +54*`)
        const prefix = args[1].replace(/[+]/g, '')
        const allUsersWithPrefix = participants.map(p => p.id).filter(jid => jid && jid !== botId && jid.split('@')[0].startsWith(prefix))
        
        if (allUsersWithPrefix.length === 0) return reply(`《✧》 Aquí no hay ningún número con el prefijo +${prefix}`)
        
        if (args[0] === 'listnum') {
            const numeros = allUsersWithPrefix.map(v => '⭔ @' + v.replace(/@.+/, ''))
            return conn.sendMessage(from, { text: `《✧》 *Lista de usuarios con prefijo +${prefix}* (${allUsersWithPrefix.length})\n\n${numeros.join('\n')}`, mentions: allUsersWithPrefix }, { quoted: msg })
        }
        
        const usersToKick = allUsersWithPrefix.filter(jid => {
            const p = participants.find(x => x.id === jid)
            if (!p) return false
            if (p.admin === 'admin' || p.admin === 'superadmin') return false
            if (jid === ownerGroup || jid === ownerBot) return false
            return true
        })
        
        if (usersToKick.length === 0) return reply(`《✧》 Hay usuarios con prefijo +${prefix} pero todos son admins o propietarios.`)
        
        await reply(`《✧》 *Eliminando usuarios con prefijo +${prefix}* (${usersToKick.length} de ${allUsersWithPrefix.length})\n> El proceso tomará unos segundos...`)
        
        let eliminados = 0, errores = [], noEliminados = allUsersWithPrefix.length - usersToKick.length
        for (const jid of usersToKick) {
            try { 
                await conn.groupParticipantsUpdate(from, [jid], 'remove')
                eliminados++
                await delay(3000) // Pausa de 3 segundos para que WhatsApp no bloquee al bot
            } catch (e) { errores.push(`@${jid.split('@')[0]}: ${e.message}`) }
        }
        
        let res = `《✧》 Proceso completado.\n> Usuarios eliminados: *${eliminados}*`
        if (noEliminados > 0) res += `\n> Usuarios omitidos (admins/owners): *${noEliminados}*`
        if (errores.length > 0) res += `\n> Errores: *${errores.length}*\n${errores.join('\n')}`
        return reply(res)
    }

    // 2. SACAR A TODOS (all) - Excepto admins
    if (args[0] === 'all') {
        const usersToKick = participants.filter(p => p.id && p.id !== botId && p.id !== ownerGroup && p.id !== ownerBot && p.admin !== 'admin' && p.admin !== 'superadmin').map(p => p.id)
        if (usersToKick.length === 0) return reply('《✧》 No hay usuarios para eliminar (todos son admins o propietarios).')
        
        await reply(`《✧》 *Eliminando todos los usuarios* (${usersToKick.length})\n> El proceso tomará unos segundos...`)
        
        let eliminados = 0, errores = [], noEliminados = participants.length - usersToKick.length
        for (const jid of usersToKick) {
            try { 
                await conn.groupParticipantsUpdate(from, [jid], 'remove')
                eliminados++
                await delay(3000) 
            } catch (e) { errores.push(`@${jid.split('@')[0]}: ${e.message}`) }
        }
        
        let res = `《✧》 Proceso completado.\n> Usuarios eliminados: *${eliminados}*`
        if (noEliminados > 0) res += `\n> Usuarios omitidos (admins/owners): *${noEliminados}*`
        if (errores.length > 0) res += `\n> Errores: *${errores.length}*\n${errores.join('\n')}`
        return reply(res)
    }

    // 3. SACAR DIRECTO (Etiqueta o Respondiendo a un mensaje)
    // Detectamos si etiquetó a alguien o si respondió al mensaje de alguien
    const msgType = Object.keys(msg.message || {})[0]
    const contextInfo = msg.message?.[msgType]?.contextInfo || {}
    const mentionedJid = contextInfo?.mentionedJid || []
    const quotedMsgParticipant = contextInfo?.participant 
    
    let targetRaw = null
    if (mentionedJid.length > 0) {
        targetRaw = mentionedJid[0] // Si mencionó a alguien, tomamos el primero
    } else if (quotedMsgParticipant) {
        targetRaw = quotedMsgParticipant // Si respondió a un mensaje, tomamos el autor de ese mensaje
    }

    // Si no mencionó a nadie ni respondió a nadie y tampoco usó comandos especiales
    if (!targetRaw) {
        return reply(`《✧》 Por favor, Etiqueta o responde al *mensaje* de la *persona* que quieres eliminar.\n\n✎ *Opciones especiales:*\n> *${usedPrefix || '/'}${command} num +57* - Eliminar todos los usuarios con prefijo +57\n> *${usedPrefix || '/'}${command} listnum +56* - Listar usuarios con prefijo +56\n> *${usedPrefix || '/'}${command} all* - Eliminar todos los usuarios`)
    }

    const userBase = targetRaw.split('@')[0]
    const participant = participants.find(p => p.id?.split('@')[0] === userBase || p.lid?.split('@')[0] === userBase)
    
    if (!participant) return conn.sendMessage(from, { text: `《✧》 *@${userBase}* ya no está en el grupo.`, mentions: [targetRaw] }, { quoted: msg })
    
    const realJid = participant.id || targetRaw
    
    if (realJid === botId) return reply('《✧》 No puedo eliminar al *bot* del grupo')
    if (realJid === ownerGroup) return reply('《✧》 No puedo eliminar al *propietario* del grupo')
    if (realJid === ownerBot) return reply('《✧》 No puedo eliminar al *propietario* del bot')
    
    try {
        await conn.groupParticipantsUpdate(from, [realJid], 'remove')
        return conn.sendMessage(from, { text: `✎ @${userBase} *eliminado* correctamente`, mentions: [targetRaw] }, { quoted: msg })
    } catch (e) {
        return reply(`> Ocurrió un error inesperado.\n> [Error: *${e.message}*]`)
    }
}
