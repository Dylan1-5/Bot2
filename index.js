import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore, delay } from '@whiskeysockets/baileys'
import P from 'pino'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'
import fs from 'fs'
import yts from 'yt-search'
import readline from 'readline'
import { downloadMedia } from './lib/ytdl.js'
import { handleKick } from './lib/kick.js'
import { startSubBot, loadAllSubBots, subBots } from './lib/subbot.js'

const decodeJid = (jid) => {
    if (!jid) return jid
    if (/:\d+@/gi.test(jid)) {
        let decode = jid.match(/:(\d+)@/gi) || []
        return jid.replace(decode[0], '@')
    }
    return jid
}

const CONFIG = {
    bannerEnabled: true
}

// ==========================================
// INTERFAZ DE CONSOLA PARA TERMUX
// ==========================================
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

// ==========================================
// LÓGICA DE PROCESAMIENTO DE MENSAJES (SHARED)
// ==========================================
export async function handleMessage(conn, m) {
    try {
        const msg = m.messages[0]
        if (!msg || !msg.message) return

        const from = msg.key.remoteJid
        const sender = msg.key.participant || msg.key.remoteJid
        const pushName = msg.pushName || 'Usuario'
        const type = Object.keys(msg.message)[0]
        
        if (type === 'protocolMessage' || type === 'senderKeyDistributionMessage') return

        const body = (type === 'conversation' ? msg.message.conversation : 
                      type === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : 
                      type === 'imageMessage' ? msg.message.imageMessage.caption : 
                      type === 'videoMessage' ? msg.message.videoMessage.caption : '') || ''

        console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`), chalk.cyan(`${pushName}:`), chalk.white(body || '[MEDIA]'))

        // LECTURA DE PREFIJO DESDE CONFIG.JS
        const prefixList = Array.isArray(global.prefix) ? global.prefix : [global.prefix]
        const usedPrefix = prefixList.find(p => body.startsWith(p))
        
        let command = ''
        let args = []
        let isCmd = false

        // 1. SI SE USA PREFIJO NORMAL (Ej: /tag, /p, /play, /kick)
        if (usedPrefix !== undefined) {
            isCmd = true
            args = body.slice(usedPrefix.length).trim().split(/ +/)
            command = args.shift().toLowerCase()
        } 
        // 2. DETECTOR DE LENGUAJE NATURAL ("bot ...")
        else if (body.toLowerCase().startsWith('bot ')) {
            const textWithoutBot = body.slice(4).trim()
            const lowerText = textWithoutBot.toLowerCase()

            if (lowerText.includes('tag') || lowerText.includes('etiqueta') || lowerText.includes('menciona') || lowerText.includes('invoca')) {
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
            } else if (lowerText.includes('creador') || lowerText.includes('owner') || lowerText.includes('dueño')) {
                isCmd = true
                command = 'owner'
                args = []
            }
        }

        if (isCmd) {
            const reply = async (text) => {
                await conn.sendPresenceUpdate('composing', from)
                await delay(500)
                await conn.sendPresenceUpdate('paused', from)
                return conn.sendMessage(from, { text }, { quoted: msg })
            }

            const react = async (emoji) => {
                return conn.sendMessage(from, { react: { text: emoji, key: msg.key } })
            }
            
            switch (command) {
                case 'menu':
                case 'help':
                case 'ayuda':
                    const menu = `Hola ${pushName} 

● Prefijo: ${usedPrefix || '/'}
● Dev: ${global.dev || 'Dy'}

――――――――――――――――――――

[ COMANDOS ]
● ${usedPrefix || '/'}ping / ${usedPrefix || '/'}p
> Ver tiempo de respuesta
● ${usedPrefix || '/'}status
> Ver estado
● ${usedPrefix || '/'}play
> Descargar nota de voz 
● ${usedPrefix || '/'}play2 / ${usedPrefix || '/'}v
> Descargar video 
● ${usedPrefix || '/'}tag / ${usedPrefix || '/'}all
> Mencionar a todos
● ${usedPrefix || '/'}kick / ${usedPrefix || '/'}ban / ${usedPrefix || '/'}sacar
> Eliminar usuario (o 'bot saca a...')
● ${usedPrefix || '/'}serbot / ${usedPrefix || '/'}jadibot
> Conectar tu número como Sub Bot
● ${usedPrefix || '/'}stopbot
> Desconectar tu Sub Bot
● ${usedPrefix || '/'}subbots / ${usedPrefix || '/'}listbots
> Ver lista de Sub Bots activos
――――――――――――――――――――`
                    
                    await conn.sendPresenceUpdate('composing', from)
                    await delay(500)
                    await conn.sendPresenceUpdate('paused', from)
                    
                    if (global.banner) {
                        await conn.sendMessage(from, { 
                            image: { url: global.banner }, 
                            caption: menu 
                        }, { quoted: msg })
                    } else {
                        await reply(menu)
                    }
                    break
                    
                case 'status':
                case 'estado':
                    const uptime = process.uptime()
                    const h = Math.floor(uptime / 3600)
                    const m = Math.floor((uptime % 3600) / 60)
                    const s = Math.floor(uptime % 60)
                    const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
                    
                    await reply(`ESTADO DEL BOT\n\n• Uptime: ${h}h ${m}m ${s}s\n• RAM: ${ram} MB\n• Node.js: ${process.version}\n• Dev: ${global.dev || 'Dy'}\n• Sub Bots Activos: ${subBots.size}`)
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
                case 'creador':
                case 'dueño':
                    const ownerNumber = global.owner?.[0]?.[0] || global.owner?.[0] || 'Sin número'
                    const ownerName = global.dev || 'Dy'
                    await reply(`INFORMACIÓN OWNER\n\nNombre: ${ownerName}\nContacto: ${ownerNumber}\n\n――――――――――――――――――――`)
                    break

                // ==========================================
                // COMANDOS DE SUB BOTS
                // ==========================================
                case 'serbot':
                case 'subbot':
                case 'code':
                    try {
                        const numInput = args[0] || sender.replace(/\D/g, '')
                        await startSubBot(conn, from, msg, numInput)
                    } catch (e) {
                        reply(`[Error en Sub Bot]: ${e.message}`)
                    }
                    break

                case 'stopbot':
                case 'stopsubbot':
                    try {
                        const senderNum = sender.replace(/\D/g, '')
                        if (subBots.has(senderNum)) {
                            const subConn = subBots.get(senderNum)
                            await subConn.logout()
                            subBots.delete(senderNum)
                            reply('《✧》 Tu Sub Bot se ha desconectado correctamente.')
                        } else {
                            reply('《✧》 No tienes ningún Sub Bot activo actualmente.')
                        }
                    } catch (e) {
                        reply(`[Error]: ${e.message}`)
                    }
                    break

                case 'bots':
                case 'subbots':
                    try {
                        if (subBots.size === 0) return reply('《✧》 No hay Sub Bots activos en este momento.')
                        let txt = `《✧》 *LISTA DE SUB BOTS ACTIVOS* (${subBots.size})\n\n`
                        for (const [num] of subBots) {
                            txt += `⭔ +${num}\n`
                        }
                        reply(txt)
                    } catch (e) {
                        reply(`[Error]: ${e.message}`)
                    }
                    break

                // ==========================================
                // ACTIVADOR DEL COMANDO SACAR / KICK
                // ==========================================
                case 'kick':
                case 'ban':
                case 'sacar':
                    try {
                        if (!from.endsWith('@g.us')) return reply('「✎」 Este comando solo funciona en grupos.')

                        const groupMetadata = await conn.groupMetadata(from)
                        const participants = groupMetadata.participants
                        
                        // VERIFICAMOS PERMISOS (QUIEN LO EJECUTA Y EL BOT)
                        const senderNumber = sender.replace(/\D/g, '')
                        const botNumber = String(conn.user?.id || '').replace(/\D/g, '')
                        const ownerNumberConfig = String(global.owner?.[0]?.[0] || global.owner?.[0] || '').replace(/\D/g, '')

                        const isUserAdmin = participants.find(p => p.id === sender)?.admin !== null
                        const isOwner = senderNumber === botNumber || 
                                        (ownerNumberConfig && senderNumber === ownerNumberConfig) || 
                                        pushName === global.dev

                        if (!isUserAdmin && !isOwner) {
                            return reply('「✎」 Este comando es solo para Administradores.')
                        }

                        const isBotAdmin = participants.find(p => p.id === botNumber + '@s.whatsapp.net')?.admin !== null
                        if (!isBotAdmin) {
                            return reply('「✎」 No puedo eliminar a nadie porque el bot no es administrador del grupo.')
                        }

                        // LLAMAMOS A LA LIBRERIA EXTERNA
                        await handleKick(conn, from, msg, args, participants, groupMetadata, usedPrefix, command)

                    } catch (e) { reply(`[Error al expulsar]: ${e.message}`) }
                    break

                // COMANDO TAG
                case 'tag':
                case 'all':
                case 'invocar':
                case 'totales': 
                    try {
                        if (!from.endsWith('@g.us')) return reply('「✎」 Este comando solo funciona en grupos.')

                        const groupMetadata = await conn.groupMetadata(from)
                        const participants = groupMetadata.participants
                        
                        const senderNumber = sender.replace(/\D/g, '')
                        const botNumber = String(conn.user?.id || '').replace(/\D/g, '')
                        const ownerNumberConfig = String(global.owner?.[0]?.[0] || global.owner?.[0] || '').replace(/\D/g, '')

                        const isUserAdmin = participants.find(p => p.id === sender)?.admin !== null
                        const isOwner = senderNumber === botNumber || 
                                        (ownerNumberConfig && senderNumber === ownerNumberConfig) || 
                                        pushName === global.dev

                        if (!isUserAdmin && !isOwner) {
                            return reply('「✎」 Este comando es solo para Administradores.')
                        }

                        const targetParticipants = participants.map(p => p.id).filter(Boolean)
                        const invisibleTag = '\u200B'.repeat(100)

                        const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.[type]?.contextInfo
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

                // COMANDO DE AUDIO
                case 'play':
                case 'mp3':
                case 'audio':
                case 'song':
                case 'musica':
                    try {
                        if (!args[0]) return reply('Ingresa un nombre o URL de YouTube')
                        
                        await react('🎵')
                        const input_text = args.join(' ').trim()

                        let search = await yts({ query: input_text }).catch(() => null)
                        let video = search?.videos?.[0]
                        if (!video) return reply('No se encontraron resultados.')

                        if (CONFIG.bannerEnabled) {
                            const captionInfo = `➩ *Descargando Nota de Voz:*
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
                        
                        await conn.sendPresenceUpdate('recording', from)
                        
                        const { filePath, cleanup } = await downloadMedia(video.url, 'vn')
                        
                        await conn.sendMessage(from, {
                            audio: fs.readFileSync(filePath),
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true
                        }, { quoted: msg })
                        
                        cleanup()
                        await conn.sendPresenceUpdate('paused', from)

                    } catch (e) { 
                        await conn.sendPresenceUpdate('paused', from)
                        reply(`[Error]: ${e.message}`) 
                    }
                    break

                // COMANDO DE VIDEO
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
                        
                        const { filePath, cleanup } = await downloadMedia(video.url, 'mp4')
                        
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
    } catch (err) { console.error(err) }
}

// ==========================================
// FUNCIÓN PRINCIPAL DEL BOT
// ==========================================
async function startBot() {
    const authFolder = 'sessions'
    const { state, saveCreds } = await useMultiFileAuthState(authFolder)
    const { version } = await fetchLatestBaileysVersion()
    
    console.info = () => {}

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

    // PEDIR NÚMERO EN LA TERMINAL SI NO HAY SESIÓN
    if (!fs.existsSync(`./${authFolder}/creds.json`) && !conn.authState.creds.registered) {
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

    // ESCUCHADOR DE MENSAJES BOT PRINCIPAL
    conn.ev.on('messages.upsert', async (m) => {
        await handleMessage(conn, m)
    })

    // ==========================================
    // CONTROL DE CONEXIÓN
    // ==========================================
    conn.ev.on('connection.update', (u) => {
        if (u.connection === 'open') {
            console.log(chalk.cyan('\n   ---------------------------------------\n    BOT INICIADO CORRECTAMENTE EN TERMUX\n   ---------------------------------------'))
            // CARGA LOS SUB BOTS GUARDADOS AL INICIAR
            loadAllSubBots(conn)
        }
        if (u.connection === 'close') {
            const reason = new Boom(u.lastDisconnect?.error)?.output.statusCode
            if (reason !== DisconnectReason.loggedOut) {
                console.log(chalk.yellow('🔄 Conexión interrumpida. Reconectando...'))
                startBot()
            } else {
                console.log(chalk.red('❌ Sesión cerrada. Eliminando archivos de sesión...'))
                if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true })
                process.exit(0)
            }
        }
    })
}

startBot().catch(err => console.error('Fallo crítico al arrancar:', err))
