import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore, delay, downloadMediaMessage, downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys'
import P from 'pino'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import util from 'util'
import yts from 'yt-search'
import readline from 'readline'
import { GoogleGenAI } from '@google/genai'
import { downloadMedia as downloadYtMedia } from './lib/ytdl.js'
import { handleSticker, rememberStickerMedia } from './lib/sticker.js'
import { handleKick } from './lib/kick.js'
import { startSubBot, loadAllSubBots, subBots, subBotOwners } from './lib/subbot.js'
import {
    smsg,
    extractNumber,
    normalizePhoneJid,
    getContextInfo,
    getMentionedJids,
    resolvePhoneFromMessage,
    resolveMentionedPhone,
    resolveJidAsync
} from './lib/Numberextractor.js'

const execPromise = util.promisify(exec)

// Inicialización de la IA con GoogleGenAI
const ai = new GoogleGenAI({ apiKey: global.geminiKey || process.env.GEMINI_API_KEY || '' })

const CONFIG = {
    bannerEnabled: true
}

const getConfiguredOwners = () => {
    const configured = Array.isArray(global.owner) ? global.owner : []

    return configured
        .map(owner => Array.isArray(owner) ? owner[0] : owner)
        .map(owner => extractNumber(String(owner || '')))
        .filter(Boolean)
}

const menuCommands = ({ prefix }) => `
ɪɴᴛᴇʟɪɢᴇɴᴄɪᴀ
  └─ *${prefix}ia <pregunta>*
  └─ *bot haz <instrucción>*

ᴄᴏɴᴛʀᴏʟ
  └─ *${prefix}ping* · *${prefix}p*
  └─ *${prefix}status* · *${prefix}estado*
  └─ *${prefix}menu* · *${prefix}help* · *${prefix}ayuda*
  └─ *${prefix}owner* · *${prefix}creador* · *${prefix}dueño*

ᴍᴜʟᴛɪᴍᴇᴅɪᴀ
  └─ *${prefix}play* · *${prefix}mp3* · *${prefix}audio*
  └─ *${prefix}song* · *${prefix}musica*
  └─ *${prefix}play2* · *${prefix}v* · *${prefix}mp4* · *${prefix}video*
  └─ *${prefix}sticker* · *${prefix}s*
  └─ *${prefix}sticker all* · *${prefix}s all* (responde al grupo)
  └─ *${prefix}fixvideo* · *${prefix}arreglarvideo* · *${prefix}repairvideo*

ɢʀᴜᴘᴏs
  └─ *${prefix}tag* · *${prefix}all* · *${prefix}invocar* · *${prefix}totales*
  └─ *${prefix}kick* · *${prefix}ban* · *${prefix}sacar*

ᴄᴏɴғɪɢᴜʀᴀᴄɪᴏ́ɴ ʏ ᴏᴡɴᴇʀ
  └─ *${prefix}setprefix* · *${prefix}prefix*
  └─ *${prefix}subprefix* · *${prefix}setsubprefix*
  └─ *${prefix}passowner* · *${prefix}passbot*
  └─ *${prefix}passsubbot* · *${prefix}paybot*

sᴜʙ ʙᴏᴛs
  └─ *${prefix}code @usuario* · *${prefix}serbot*
  └─ *${prefix}subbot* · *${prefix}jadibot*
  └─ *${prefix}bots* · *${prefix}subbots* · *${prefix}listbots*
  └─ *${prefix}stopbot* · *${prefix}stopsubbot*`

const premium2Menu = ({ name, prefix, dev, userMention, botName }) => `╭══════════════════════════════╮
║         ᴘʀᴇᴍɪᴜᴍ ²              ║
╰══════════════════════════════╯

        *Bienvenido, ${name}*
        ──────────────────
        Prefijo  ›  \`${prefix}\`
        Dev      ›  \`${dev}\`

Hola ${userMention}, soy ${botName}
${menuCommands({ prefix })}

        ── · ──
     _Elegancia en cada comando_
        ── · ──`

const premiumMenu = ({ name, prefix, dev, userMention, botName }) => `╭─────── · ───────╮
      ᴍᴇɴᴜ ᴘʀᴇᴍɪᴜᴍ
╰─────── · ───────╯

*Bienvenido, ${name}*
_Prefijo:_ \`${prefix}\`
_Dev:_ \`${dev}\`

Hola ${userMention}, soy ${botName}
${menuCommands({ prefix })}

_Desarrollado por ${dev}_`

// Helper para descargar archivos multimedia
async function downloadMedia(m, conn) {
    try {
        let message = m.message
        if (!message) throw new Error('No se encontró contenido en el mensaje')

        if (message.ephemeralMessage) message = message.ephemeralMessage.message
        if (message.viewOnceMessage) message = message.viewOnceMessage.message
        if (message.viewOnceMessageV2) message = message.viewOnceMessageV2.message
        if (message.viewOnceMessageV2Extension) message = message.viewOnceMessageV2Extension.message
        if (message.documentWithCaptionMessage) message = message.documentWithCaptionMessage.message

        try {
            const buffer = await downloadMediaMessage(
                { message },
                'buffer',
                {},
                {
                    logger: P({ level: 'silent' }),
                    reuploadRequest: conn ? conn.updateMediaMessage : undefined
                }
            )
            if (buffer && buffer.length > 0) return buffer
        } catch (e) {
            console.log(chalk.yellow('[DownloadMedia] Falló método principal, intentando método secundario...'))
        }

        const type = getContentType(message)
        const mediaObj = message[type] || message.videoMessage || message.imageMessage || message.audioMessage

        if (!mediaObj) throw new Error('El mensaje no contiene ningún archivo multimedia válido')

        let streamType = type ? type.replace('Message', '') : 'video'
        if (streamType === 'ptv') streamType = 'video'

        const stream = await downloadContentFromMessage(mediaObj, streamType)
        let buffer = Buffer.from([])

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }

        return buffer
    } catch (error) {
        throw new Error(`Error al descargar media: ${error.message}`)
    }
}

const question = (text) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    return new Promise((resolve) => {
        rl.question(text, (answer) => {
            rl.close()
            resolve(answer)
        })
    })
}

const findGroupParticipant = async (conn, participants, groupJid, jidCandidates = [], numberCandidates = []) => {
    const jids = jidCandidates.filter(Boolean).map(String)
    const numbers = numberCandidates.map(extractNumber).filter(Boolean)

    const matches = (participant) => {
        const ids = [
            participant?.id,
            participant?.jid,
            participant?.lid,
            participant?.participant,
            participant?.phoneNumber,
            participant?.pn
        ].filter(Boolean).map(String)

        return ids.some(id => jids.includes(id) || numbers.includes(extractNumber(id)))
    }

    const direct = participants.find(matches)
    if (direct) return direct

    // Si el grupo entrega participantes como LID, resolvemos esos IDs antes
    // de decidir si el usuario es administrador.
    for (const participant of participants) {
        const ids = [participant?.id, participant?.jid, participant?.lid, participant?.participant].filter(Boolean)
        for (const id of ids) {
            const resolved = await resolveJidAsync(id, conn, groupJid)
            if (jids.includes(resolved) || numbers.includes(extractNumber(resolved))) return participant
        }
    }

    return undefined
}

export async function handleMessage(conn, m, options = {}) {
    try {
        const incomingMessages = Array.isArray(m?.messages) ? m.messages : []

        // Un mismo upsert puede contener todas las imágenes de un álbum.
        // Se guardan antes de procesar solamente el primer mensaje.
        if (incomingMessages.length > 1) {
            for (const candidate of incomingMessages) {
                if (!candidate?.message) continue
                const candidateNumber = await resolvePhoneFromMessage(conn, candidate)
                rememberStickerMedia(candidate, candidateNumber)
            }
        }

        const msg = incomingMessages[0] || m[0]
        if (!msg || !msg.message) return

        const from = (msg.key.remoteJid?.endsWith('@lid') && msg.key.remoteJidAlt)
            ? msg.key.remoteJidAlt
            : msg.key.remoteJid
        const sender = msg.key.participant || msg.key.remoteJid
        const senderNumber = await resolvePhoneFromMessage(conn, msg)
        const pushName = msg.pushName || 'Usuario'
        const type = Object.keys(msg.message)[0]
        rememberStickerMedia(msg, senderNumber)
        
        if (type === 'protocolMessage' || type === 'senderKeyDistributionMessage') return

        const body = (type === 'conversation' ? msg.message.conversation : 
                      type === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : 
                      type === 'imageMessage' ? msg.message.imageMessage.caption : 
                      type === 'videoMessage' ? msg.message.videoMessage.caption : '') || ''

        console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`), chalk.cyan(`${pushName}:`), chalk.white(body || '[MEDIA]'))

        const activePrefix = options.isSubBot 
            ? (options.prefix || global.subPrefix || global.subprefix || ['#'])
            : (global.prefix || ['/'])

        const prefixList = Array.isArray(activePrefix) ? activePrefix : [activePrefix]
        const usedPrefix = prefixList.find(p => body.startsWith(p))
        
        let command = ''
        let args = []
        let isCmd = false

        // 1. SI SE USA PREFIJO NORMAL
        if (usedPrefix !== undefined) {
            isCmd = true
            args = body.slice(usedPrefix.length).trim().split(/ +/)
            command = args.shift().toLowerCase()
        } 
        // 2. DETECTOR DE LENGUAJE NATURAL ("bot ...")
        else if (body.toLowerCase().startsWith('bot ')) {
            const textWithoutBot = body.slice(4).trim()
            const lowerText = textWithoutBot.toLowerCase()

            if (/^(ia|haz|hace|hazlo|que)\b/i.test(textWithoutBot)) {
                isCmd = true
                command = 'ia'
                const taskQuery = textWithoutBot.replace(/^(ia|haz|hace|hazlo|que)\s*/i, '').trim()
                args = taskQuery ? [taskQuery] : []
            } else if (lowerText.includes('tag') || lowerText.includes('etiqueta') || lowerText.includes('menciona') || lowerText.includes('invoca')) {
                isCmd = true
                command = 'tag'
                const query = textWithoutBot.replace(/(haz|has|hace|un|manda|este|mensaje|tag|a|etiqueta|menciona|a|todos|invoca)/gi, '').trim()
                args = query ? query.split(/ +/) : []
            } else if (lowerText.includes('saca') || lowerText.includes('sácalo') || lowerText.includes('sacalo') || lowerText.includes('elimina') || lowerText.includes('kick') || lowerText.includes('banear')) {
                isCmd = true
                command = 'kick'
                const query = textWithoutBot.replace(/(sácalo|sacalo|saca|elimina|banear|a|al|este|usuario|kick|del|grupo)/gi, '').trim()
                args = query ? query.split(/ +/) : []
            } else if (lowerText.includes('audio') || lowerText.includes('musica') || lowerText.includes('cancion') || lowerText.includes('canción')) {
                isCmd = true
                command = 'play'
                const query = textWithoutBot.replace(/(busca|descarga|pon|pone|el|la|audio|musica|música|cancion|canción|de|en|youtube)/gi, '').trim()
                args = query ? query.split(/ +/) : []
            } else if (lowerText.includes('video') || lowerText.includes('vídeo')) {
                isCmd = true
                command = 'play2'
                const query = textWithoutBot.replace(/(busca|descarga|pon|pone|el|la|video|vídeo|de|en|youtube)/gi, '').trim()
                args = query ? query.split(/ +/) : []
            } else if (lowerText.includes('ping') || lowerText.includes('tiempo') || lowerText.includes('reaccion') || lowerText.includes('reacción') || lowerText.includes('latencia')) {
                isCmd = true
                command = 'ping'
                args = []
            } else if (lowerText.includes('estado') || lowerText.includes('status') || lowerText.includes('ram')) {
                isCmd = true
                command = 'status'
                args = []
            } else if (lowerText.includes('menu') || lowerText.includes('ayuda') || lowerText.includes('comandos')) {
                isCmd = true
                command = 'menu'
                args = []
            } else if (lowerText.includes('dueño')) {
                isCmd = true
                command = 'dueño'
                args = []
            } else if (lowerText.includes('creador') || lowerText.includes('owner')) {
                isCmd = true
                command = 'owner'
                args = []
            }
        }

        if (isCmd) {
            const reply = async (text, opt = {}, extra = {}) => {
                await conn.sendPresenceUpdate('composing', from)
                if (!options.fast) await delay(500)
                await conn.sendPresenceUpdate('paused', from)
                return conn.sendMessage(from, { text, ...extra }, { quoted: msg, ...opt })
            }

            const react = async (emoji) => {
                return conn.sendMessage(from, { react: { text: emoji, key: msg.key } })
            }
            
            switch (command) {
                case 'ia': {
                    try {
                        const prompt = args.join(' ')
                        if (!prompt) return reply('「✎」 Dime qué quieres que haga. Ejemplo: *bot haz un resumen de la fotosíntesis*')

                        await react('🧠')
                        await conn.sendPresenceUpdate('composing', from)

                        const response = await ai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: prompt,
                            config: {
                                systemInstruction: "Eres un asistente de WhatsApp atento, servicial y directo. Responde adecuadamente a la instrucción o petición del usuario."
                            }
                        })

                        await conn.sendPresenceUpdate('paused', from)
                        await reply(response.text)
                    } catch (e) {
                        await conn.sendPresenceUpdate('paused', from)
                        console.error('[Error IA]:', e)
                        reply(`[Error de IA]: ${e.message}`)
                    }
                    break
                }

                case 'sticker':
                case 's': {
                    const stickerArgs = args.map(arg => String(arg).trim()).filter(Boolean)
                    const isStickerAll = stickerArgs.some(arg => arg.toLowerCase() === 'all')

                    await handleSticker(conn, msg, {
                        args: stickerArgs,
                        all: isStickerAll,
                        prefix: usedPrefix || prefixList[0],
                        command
                    })
                    break
                }

                case 'menu':
                case 'help':
                case 'ayuda':
                    const menuMentionJid = senderNumber ? `${senderNumber}@s.whatsapp.net` : (msg.sender || sender)
                    const menuMention = senderNumber ? `@${senderNumber}` : '@usuario'
                    const menu = (options.isSubBot ? premiumMenu : premium2Menu)({
                        name: pushName,
                        prefix: usedPrefix || prefixList[0],
                        dev: global.dev || 'Dy',
                        botName: global.botName || 'Hi Bot',
                        userMention: menuMention
                    })
                    
                    await conn.sendPresenceUpdate('composing', from)
                    if (!options.fast) await delay(500)
                    await conn.sendPresenceUpdate('paused', from)
                    
                    if (global.banner) {
                        await conn.sendMessage(from, {
                            image: { url: global.banner },
                            caption: menu,
                            mentions: menuMentionJid && !menuMentionJid.endsWith('@lid') ? [menuMentionJid] : []
                        }, { quoted: msg })
                    } else {
                        await reply(menu, {}, { mentions: menuMentionJid && !menuMentionJid.endsWith('@lid') ? [menuMentionJid] : [] })
                    }
                    break

                case 'status':
                case 'estado':
                    const uptime = process.uptime()
                    const h = Math.floor(uptime / 3600)
                    const m_time = Math.floor((uptime % 3600) / 60)
                    const s = Math.floor(uptime % 60)
                    const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
                    
                    await reply(`ESTADO DEL BOT\n\n• Uptime: ${h}h ${m_time}m ${s}s\n• RAM: ${ram} MB\n• Node.js: ${process.version}\n• Dev: ${global.dev || 'Dy'}\n• Sub Bots Activos: ${subBots ? subBots.size : 0}`)
                    break
                    
                case 'ping':
                case 'p':
                    const start = Date.now()
                    await conn.sendPresenceUpdate('composing', from)
                    const { key } = await conn.sendMessage(from, { text: '⚡ Probando tiempo de reacción...' }, { quoted: msg })
                    const latency = Date.now() - start
                    await conn.sendMessage(from, { text: `🚀 *PONG!*\n⏱️ Tiempo de respuesta: *${latency} ms*`, edit: key })
                    break
                    
                case 'owner':
                case 'creador': {
                    const owners = getConfiguredOwners()

                    if (owners.length === 0) {
                        return await reply('INFORMACIÓN OWNER\n\nNo hay ningún Owner configurado en config.js.')
                    }

                    const title = owners.length === 1 ? 'OWNER ACTUAL' : 'OWNERS ACTUALES'
                    const list = owners.map((number, index) => `${index + 1}. +${number}`).join('\n')

                    await reply(`${title}\n\n${list}\n\nNombre del bot: ${global.dev || 'Dy'}\n\n――――――――――――――――――――`)
                    break
                }

                case 'dueño': {
                    if (!subBotOwners || subBotOwners.size === 0) {
                        return await reply('DUEÑOS DE SUB BOTS\n\nNo hay Sub Bots con dueño asignado.')
                    }

                    const list = [...subBotOwners.entries()]
                        .map(([botNumber, ownerNumber], index) => `${index + 1}. Sub Bot: +${extractNumber(botNumber) || botNumber}\n   Dueño: +${extractNumber(ownerNumber) || ownerNumber}`)
                        .join('\n')

                    await reply(`DUEÑOS DE SUB BOTS\n\n${list}\n\n――――――――――――――――――――`)
                    break
                }

                case 'fixvideo':
                case 'arreglarvideo':
                case 'repairvideo': {
                    let inputPath = ''
                    let outputPath = ''
                    try {
                        const contextInfo = getContextInfo(msg)
                        const quotedMsg = contextInfo?.quotedMessage

                        const isQuotedVideo = quotedMsg && (quotedMsg.videoMessage || quotedMsg.viewOnceMessage?.message?.videoMessage || quotedMsg.viewOnceMessageV2?.message?.videoMessage)
                        const isVideo = type === 'videoMessage'

                        if (!isVideo && !isQuotedVideo) {
                            return reply('「✎」 Responde a un video dañado o no ejecutable con el comando */arreglarvideo*')
                        }

                        await react('🛠️')

                        const targetMsg = isQuotedVideo ? { message: quotedMsg } : msg
                        const mediaBuffer = await downloadMedia(targetMsg, conn)

                        if (!mediaBuffer || mediaBuffer.length === 0) {
                            return reply('《✧》 No se pudo extraer el archivo multimedia.')
                        }

                        const tmpDir = path.join(process.cwd(), 'tmp')
                        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

                        inputPath = path.join(tmpDir, `input_${Date.now()}.mp4`)
                        outputPath = path.join(tmpDir, `fixed_${Date.now()}.mp4`)

                        fs.writeFileSync(inputPath, mediaBuffer)

                        let hasAudio = false
                        try {
                            const { stdout } = await execPromise(`ffprobe -i "${inputPath}" -show_streams -select_streams a -loglevel error`)
                            if (stdout && stdout.trim().length > 0) {
                                hasAudio = true
                            }
                        } catch (e) {
                            hasAudio = false
                        }

                        if (hasAudio) {
                            await reply('《 ⚙️ 》 *SISTEMA:* Video con audio detectado. Corrigiendo dimensiones impares y optimizando...')
                        } else {
                            await reply('《 🔇 》 *SISTEMA:* Video/GIF mudo detectado. Corrigiendo dimensiones impares y renderizando...')
                        }

                        const videoFilter = '"pad=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1"'

                        let ffmpegCmd = ''
                        if (hasAudio) {
                            ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vf ${videoFilter} -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 128k -pix_fmt yuv420p -movflags +faststart "${outputPath}"`
                        } else {
                            ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vf ${videoFilter} -c:v libx264 -preset ultrafast -crf 26 -an -pix_fmt yuv420p -movflags +faststart "${outputPath}"`
                        }

                        await execPromise(ffmpegCmd)

                        if (fs.existsSync(outputPath)) {
                            const fixedBuffer = fs.readFileSync(outputPath)

                            await conn.sendMessage(from, {
                                video: fixedBuffer,
                                caption: hasAudio 
                                    ? '《 ⚡ 》 *¡Proceso completado!* Video reparado, dimensiones impares corregidas y audio optimizado. 🎥'
                                    : '《 ⚡ 》 *¡Proceso completado!* Video reparado y dimensiones impares corregidas (modo mudo). 🎬'
                            }, { quoted: msg })
                        } else {
                            throw new Error('El archivo procesado no se generó correctamente.')
                        }
                    } catch (err) {
                        console.error('[Error Arreglando Video]:', err)
                        reply(`[Error al reparar video]: ${err.message}`)
                    } finally {
                        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
                        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
                    }
                    break
                }

                case 'setprefix':
                case 'prefix':
                    try {
                        const currentSenderNumber = senderNumber
                        const configuredOwners = getConfiguredOwners()
                        const isOwner = configuredOwners.includes(currentSenderNumber)

                        if (!isOwner) return reply('「✎」 Este comando solo lo puede usar un Owner configurado en global.owner.')
                        if (!args[0]) return reply(`「✎」 Ingresa el nuevo prefijo del Bot Principal. Ejemplo: *${usedPrefix || '/'}setprefix !*`)

                        global.prefix = [args[0]]
                        reply(`✅ *Prefijo del Bot Principal cambiado a:* *${args[0]}*`)
                    } catch (e) {
                        reply(`[Error]: ${e.message}`)
                    }
                    break

                case 'subprefix':
                case 'setsubprefix':
                    try {
                        const currentSenderNumber = senderNumber
                        const ownerNumberConfig = extractNumber(global.owner?.[0]?.[0] || global.owner?.[0] || '')
                        const isOwner = currentSenderNumber === ownerNumberConfig || pushName === global.dev

                        if (!isOwner) return reply('「✎」 Este comando solo lo puede usar el Owner del bot.')
                        if (!args[0]) return reply(`「✎」 Ingresa el nuevo prefijo para los Sub Bots. Ejemplo: *${usedPrefix || '/'}subprefix #*`)

                        const newSubPrefix = args[0]
                        global.subPrefix = [newSubPrefix]
                        global.subprefix = [newSubPrefix]

                        reply(`🤖 *Prefijo global de Sub Bots actualizado a:* *${newSubPrefix}*`)
                    } catch (e) {
                        reply(`[Error]: ${e.message}`)
                    }
                    break

                case 'serbot':
                case 'subbot':
                case 'code':
                case 'jadibot':
                    try {
                        const mentionedJid = getMentionedJids(msg)[0]
                        const hasExplicitMention = Boolean(mentionedJid || String(args[0] || '').startsWith('@'))
                        const targetNumber = normalizePhoneJid(args[0])
                            || await resolveMentionedPhone(conn, msg, mentionedJid)
                            || (!hasExplicitMention ? senderNumber : '')

                        if (!targetNumber || targetNumber.length < 8) {
                            return reply('《✧》 No se pudo identificar un número de teléfono válido para la vinculación.')
                        }

                        await startSubBot(conn, from, msg, targetNumber, handleMessage, senderNumber)
                    } catch (e) {
                        reply(`[Error en Sub Bot]: ${e.message}`)
                    }
                    break
                    
                case 'stopbot':
                case 'stopsubbot':
                    try {
                        const senderNum = senderNumber

                        let botSessionKey = null
                        if (subBotOwners) {
                            for (const [botNum, ownerNum] of subBotOwners.entries()) {
                                if (ownerNum === senderNum) {
                                    botSessionKey = botNum
                                    break
                                }
                            }
                        }

                        if (botSessionKey && subBots && subBots.has(botSessionKey)) {
                            const subConn = subBots.get(botSessionKey)
                            await subConn.logout()
                            subBots.delete(botSessionKey)
                            if (subBotOwners) subBotOwners.delete(botSessionKey)
                            reply('《✧》 Tu Sub Bot se ha desconectado correctamente.')
                        } else {
                            reply('《✧》 Solo el dueño asignado del Sub Bot puede apagar esta sesión.')
                        }
                    } catch (e) {
                        reply(`[Error]: ${e.message}`)
                    }
                    break
                    
                case 'passowner':
                case 'passbot':
                case 'passsubbot':
                case 'paybot':
                    try {
                        const senderNum = senderNumber
                        const targetJid = getMentionedJids(msg)[0]

                        if (!targetJid) {
                            return reply('《✧》 Menciona al usuario al que le deseas transferir el Sub Bot. Ejemplo: *.passowner @usuario*')
                        }

                        const newOwnerNum = await resolveMentionedPhone(conn, msg, targetJid)

                        if (!newOwnerNum) {
                            return reply('《✧》 No pude obtener el número real del usuario mencionado. Intentá mencionarlo de nuevo.')
                        }

                        let botSessionKey = null
                        if (subBotOwners) {
                            for (const [botNum, ownerNum] of subBotOwners.entries()) {
                                if (ownerNum === senderNum) {
                                    botSessionKey = botNum
                                    break
                                }
                            }
                        }

                        if (!botSessionKey) {
                            return reply('《✧》 Solo el dueño actual del Sub Bot puede transferir los privilegios (o no posees ningún Sub Bot activo).')
                        }

                        if (subBotOwners) subBotOwners.set(botSessionKey, newOwnerNum)
                        reply(`《✧》 Transferencia exitosa. El control del Sub Bot (+${botSessionKey}) ahora pertenece a @${newOwnerNum}`, {}, { mentions: [targetJid] })
                    } catch (e) {
                        reply(`[Error al transferir]: ${e.message}`)
                    }
                    break
                    
                case 'bots':
                case 'subbots':
                case 'listbots':
                    try {
                        if (!subBots || subBots.size === 0) return reply('《✧》 No hay Sub Bots activos en este momento.')
                        let txt = `《✧》 *LISTA DE SUB BOTS ACTIVOS* (${subBots.size})\n\n`
                        for (const [num] of subBots) {
                            txt += `⭔ +${num}\n`
                        }
                        reply(txt)
                    } catch (e) {
                        reply(`[Error]: ${e.message}`)
                    }
                    break

                case 'kick':
                case 'ban':
                case 'sacar':
                    try {
                        if (!from.endsWith('@g.us')) return reply('「✎」 Este comando solo funciona en grupos.')

                        const groupMetadata = await conn.groupMetadata(from)
                        const participants = groupMetadata.participants
                        
                        const currentSenderNumber = senderNumber
                        const botNumber = extractNumber(conn.user?.id || '')
                        const configuredOwners = getConfiguredOwners()

                        const senderJids = [
                            sender,
                            msg.key?.participant,
                            msg.key?.participantAlt,
                            msg.key?.participantPn,
                            msg.key?.remoteJidAlt
                        ]
                        const userParticipant = await findGroupParticipant(
                            conn,
                            participants,
                            from,
                            senderJids,
                            [currentSenderNumber]
                        )
                        const isUserAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin'
                        const isOwner = currentSenderNumber === botNumber || configuredOwners.includes(currentSenderNumber)

                        if (!isUserAdmin && !isOwner) {
                            return reply('「✎」 Este comando es solo para Administradores.')
                        }

                        const botJid = await resolveJidAsync(conn.user?.id || '', conn, from)
                        const botParticipant = await findGroupParticipant(
                            conn,
                            participants,
                            from,
                            [conn.user?.id, conn.user?.lid, botJid],
                            [botNumber, extractNumber(botJid)]
                        )
                        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin'
                        if (!isBotAdmin) {
                            return reply('「✎」 No puedo eliminar a nadie porque el bot no es administrador del grupo.')
                        }

                        await handleKick(conn, from, msg, args, participants, groupMetadata, usedPrefix, command)

                    } catch (e) { reply(`[Error al expulsar]: ${e.message}`) }
                    break

                case 'tag':
                case 'all':
                case 'invocar':
                case 'totales': 
                    try {
                        if (!from.endsWith('@g.us')) return reply('「✎」 Este comando solo funciona en grupos.')

                        const groupMetadata = await conn.groupMetadata(from)
                        const participants = groupMetadata.participants
                        
                        const currentSenderNumber = senderNumber
                        const botNumber = extractNumber(conn.user?.id || '')
                        const ownerNumberConfig = extractNumber(global.owner?.[0]?.[0] || global.owner?.[0] || '')

                        const senderJids = [
                            sender,
                            msg.key?.participant,
                            msg.key?.participantAlt,
                            msg.key?.participantPn,
                            msg.key?.remoteJidAlt
                        ]
                        const userParticipant = await findGroupParticipant(
                            conn,
                            participants,
                            from,
                            senderJids,
                            [currentSenderNumber]
                        )
                        const isUserAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin'
                        const isOwner = currentSenderNumber === botNumber || 
                                        (ownerNumberConfig && currentSenderNumber === ownerNumberConfig) || 
                                        pushName === global.dev

                        if (!isUserAdmin && !isOwner) {
                            return reply('「✎」 Este comando es solo para Administradores.')
                        }

                        const targetParticipants = participants.map(p => p.id).filter(Boolean)
                        const invisibleTag = '\u200B'.repeat(100)

                        const contextInfo = getContextInfo(msg)
                        const quotedMsg = contextInfo?.quotedMessage

                        await conn.sendPresenceUpdate('composing', from)

                        if (quotedMsg) {
                            const quotedType = Object.keys(quotedMsg)[0]
                            const quotedContent = quotedMsg[quotedType]
                            let customText = args.join(' ').trim()

                            if (quotedType === 'conversation' || quotedType === 'extendedTextMessage') {
                                let textToFormat = customText || quotedContent.text || quotedContent || ''
                                return await conn.sendMessage(from, {
                                    text: `${textToFormat} ${invisibleTag}`,
                                    mentions: targetParticipants
                                }, { quoted: msg })
                            }

                            const quotedKey = {
                                remoteJid: from,
                                fromMe: contextInfo.participant === conn.user?.id,
                                id: contextInfo.stanzaId,
                                participant: contextInfo.participant
                            }

                            return await conn.sendMessage(from, {
                                forward: {
                                    key: quotedKey,
                                    message: quotedMsg
                                },
                                contextInfo: {
                                    mentionedJid: targetParticipants
                                }
                            })
                        }

                        let textMessage = args.join(' ').trim()
                        if (!textMessage) return reply('「✎」 Ingresa un mensaje o responde a un archivo.')

                        let fullTextMessage = `${textMessage} ${invisibleTag}`

                        await conn.sendMessage(from, { 
                            text: fullTextMessage, 
                            mentions: targetParticipants 
                        }, { quoted: msg })

                    } catch (e) { reply(`[Error]: ${e.message}`) }
                    break

                case 'play':
case 'mp3':
case 'audio':
case 'song':
case 'musica':
    try {
        // 🛡️ ANTI-SPAM
        const now = Date.now()
        const cooldownTime = 10000
        const spamKey = `${from}:${sender || pushname || 'user'}`

        if (!global.playCooldown) {
            global.playCooldown = new Map()
        }

        const lastUse = global.playCooldown.get(spamKey) || 0
        const remaining = cooldownTime - (now - lastUse)

        if (remaining > 0) {
            const seconds = Math.ceil(remaining / 1000)

            return reply(
                `⏳ Espera ${seconds}s antes de volver a usar *play*.`
            )
        }

        global.playCooldown.set(spamKey, now)

        // 🧹 Limpieza automática del cooldown
        setTimeout(() => {
            global.playCooldown.delete(spamKey)
        }, cooldownTime)

        if (!args[0]) {
            return reply('Ingresa un nombre o URL de YouTube')
        }

        await react('🎵')

        const input_text = args.join(' ').trim()

        const search = await yts({
            query: input_text
        }).catch(() => null)

        const videos = (search?.videos || []).slice(0, 3)

        if (!videos.length) {
            return reply('No se encontraron resultados.')
        }

        await conn.sendPresenceUpdate(
            'recording',
            from
        )

        let media = null
        let video = null
        let lastError = null

        for (const result of videos) {
            try {
                media = await downloadYtMedia(
                    result.url,
                    'vn'
                )

                video = result
                break

            } catch (error) {
                lastError = error
            }
        }

        if (!media || !video) {
            throw lastError || new Error(
                'No se pudo descargar ningún resultado.'
            )
        }

        if (CONFIG.bannerEnabled) {

            const captionInfo = `➩ *Descargando Nota de Voz:*
${video.title}

│ ❖ *Canal:* ${video.author.name}
│ ⏳ *Duración:* ${video.timestamp}
│ ❀ *Vistas:* ${video.views.toLocaleString()}
│ ☆ *Publicado:* ${video.ago}
│ 🔗 *Enlace:* ${video.url}`

            await conn.sendPresenceUpdate(
                'composing',
                from
            )

            await delay(500)

            await conn.sendMessage(
                from,
                {
                    image: {
                        url: video.image
                    },
                    caption: captionInfo
                },
                {
                    quoted: msg
                }
            )

            await conn.sendPresenceUpdate(
                'recording',
                from
            )
        }

        const {
            filePath,
            cleanup
        } = media

        await conn.sendMessage(
            from,
            {
                audio: fs.readFileSync(filePath),
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            },
            {
                quoted: msg
            }
        )

        cleanup()

        await conn.sendPresenceUpdate(
            'paused',
            from
        )

    } catch (e) {

        await conn.sendPresenceUpdate(
            'paused',
            from
        )

        return reply(
            '❌ No se pudo descargar el audio.'
        )
    }

    break
                case 'v':
                case 'play2':
                case 'mp4':
                case 'video':
                    try {
                        if (!args[0]) return reply('Ingresa un nombre o URL de YouTube')
                        
                        await react('🎬')
                        const input_text = args.join(' ').trim()

                        let search = await yts({ query: input_text }).catch(() => null)
                        let video = search?.videos?.[0]
                        if (!video) return reply('No se encontraron resultados.')

                        if (CONFIG.bannerEnabled) {
                            const captionInfo = `➩ *Descargando Video:*
${video.title}

│ ❖ *Canal:* ${video.author.name}
│ ⏳ *Duración:* ${video.timestamp}
│ ❀ *Vistas:* ${video.views.toLocaleString()}
│ ☆ *Publicado:* ${video.ago}
│ 🔗 *Enlace:* ${video.url}`

                            await conn.sendPresenceUpdate('composing', from)
                            await delay(500)
                            await conn.sendMessage(from, { image: { url: video.image }, caption: captionInfo }, { quoted: msg })
                        }
                        
                        await conn.sendPresenceUpdate('composing', from)
                        
                        const { filePath, cleanup } = await downloadYtMedia(video.url, 'mp4')
                        
                        await conn.sendMessage(from, {
                            video: fs.readFileSync(filePath),
                            fileName: `${video.title}.mp4`,
                            mimetype: 'video/mp4'
                        }, { quoted: msg })
                        
                        cleanup()
                        await conn.sendPresenceUpdate('paused', from)

                    } catch (e) { 
                        await conn.sendPresenceUpdate('paused', from)
                        reply(`[Error]: ${e.message}`) 
                    }
                    break

                default:
                    if (usedPrefix !== undefined && body.startsWith(usedPrefix)) {
                        reply(`El comando *${usedPrefix}${command}* no existe.\nUsa *${usedPrefix}menu* para ver la lista de comandos.`)
                    }
                    break
            }
        }
    } catch (err) { 
        console.error(err) 
    }
}

let reconnectTimer = null

function scheduleReconnect() {
    if (reconnectTimer) return

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        startBot().catch(error => {
            console.error('[Error reconectando]:', error)
            scheduleReconnect()
        })
    }, 5000)
}

async function startBot() {
    const authFolder = 'sessions'
    const { state, saveCreds } = await useMultiFileAuthState(authFolder)
    const { version } = await fetchLatestBaileysVersion()
    
    console.info = () => {}

    const conn = makeWASocket({
        version,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000,
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

    if (!state.creds.registered) {
        console.log(chalk.cyan('\n======================================'))
        console.log(chalk.cyan('        CONFIGURACIÓN DE TERMUX'))
        console.log(chalk.cyan('======================================\n'))

        let phoneNumber = await question(chalk.yellow('Ingresa tu número de WhatsApp (Ej: 50612345678): '))
        phoneNumber = phoneNumber.replace(/[\s\-()+]/g, '')

        if (phoneNumber) {
            console.log(chalk.cyan('\nSolicitando código de vinculación...\n'))
            setTimeout(async () => {
                try {
                    let codeBot = await conn.requestPairingCode(phoneNumber)
                    codeBot = codeBot.match(/.{1,4}/g)?.join("-") || codeBot
                    console.log(chalk.green('======================================'))
                    console.log(chalk.green('🔑 TU CÓDIGO DE VINCULACIÓN ES:'))
                    console.log(chalk.white(`👉    ${codeBot}    👈`))
                    console.log(chalk.green('======================================\n'))
                } catch (err) {
                    console.error(chalk.red('❌ Error al solicitar código:'), err)
                }
            }, 2000)
        } else {
            console.log(chalk.red('\n[!] Número no válido.'))
            process.exit(1)
        }
    }

    conn.ev.on('messages.upsert', async ({ messages, type: upsertType }) => {
        const incoming = messages || []
        const prepared = []

        try {
            // Primero serializamos y guardamos todos los medios del lote.
            // Así un comando acumulado puede ejecutarse sin esperar el historial.
            for (const message of incoming) {
                if (!message?.message) continue
                const serialized = await smsg(conn, message)
                const number = await resolvePhoneFromMessage(conn, serialized)
                rememberStickerMedia(serialized, number)
                const messageType = Object.keys(serialized.message || {})[0] || ''
                const media = serialized.message?.[messageType] || {}
                const body = messageType === 'conversation'
                    ? serialized.message.conversation || ''
                    : messageType === 'extendedTextMessage'
                        ? media.text || ''
                        : media.caption || ''
                const prefixes = [global.prefix, global.subPrefix, global.subprefix]
                    .flatMap(value => Array.isArray(value) ? value : [value])
                    .filter(Boolean)
                const isCommand = prefixes.some(prefix => body.startsWith(prefix)) || body.toLowerCase().startsWith('bot ')
                prepared.push({ serialized, isCommand })
            }

            // Los comandos pendientes tienen prioridad sobre mensajes históricos.
            prepared.sort((a, b) => Number(b.isCommand) - Number(a.isCommand))

            for (const item of prepared) {
                await handleMessage(conn, { messages: [item.serialized] }, {
                    fast: upsertType === 'append'
                })
            }
        } catch (error) {
            console.error('[Error procesando lote de mensajes]:', error)
        }
    })

    conn.ev.on('connection.update', (u) => {
        if (u.connection === 'open') {
            console.log(chalk.cyan('\n   ---------------------------------------\n    BOT INICIADO CORRECTAMENTE EN TERMUX\n   ---------------------------------------'))
            loadAllSubBots(conn, handleMessage)
        }

        if (u.connection === 'close') {
            const reason = new Boom(u.lastDisconnect?.error)?.output?.statusCode

            if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.red('❌ Sesión cerrada por WhatsApp. Eliminando archivos de sesión...'))
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true })
                }
                process.exit(0)
            }

            console.log(chalk.yellow(`🔄 Conexión interrumpida (${reason || 'sin código'}). Reconectando en 5 segundos...`))
            scheduleReconnect()
        }
    })
}

startBot().catch(err => {
    console.error('Fallo crítico al arrancar:', err)
    scheduleReconnect()
})
