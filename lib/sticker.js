import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import P from 'pino'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { extractNumber, resolvePhoneFromMessage } from './Numberextractor.js'

const TMP_DIR = path.join(process.cwd(), 'tmp')
const STICKER_OWNER_NUMBER = '50662907002'
const STICKER_BATCH_TTL = 30 * 60 * 1000
const STICKER_BATCH_MAX = 20
const stickerMediaQueue = new Map()
const logger = P({ level: 'silent' })

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

export const rememberStickerMedia = (msg, senderNumber = '') => {
    if (msg?.key?.fromMe) return
    const type = Object.keys(msg?.message || {})[0] || ''
    if (!/imageMessage|videoMessage|stickerMessage/.test(type)) return

    const chat = msg?.key?.remoteJid
    if (!chat) return

    const now = Date.now()
    const current = (stickerMediaQueue.get(chat) || [])
        .filter(item => now - item.createdAt < STICKER_BATCH_TTL)

    current.push({ msg, senderNumber, createdAt: now })
    stickerMediaQueue.set(chat, current.slice(-STICKER_BATCH_MAX))
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const shapeArgs = {
    '-c': 'circle', '-t': 'triangle', '-s': 'star', '-r': 'roundrect',
    '-h': 'hexagon', '-d': 'diamond', '-f': 'frame', '-b': 'border',
    '-w': 'wave', '-m': 'mirror', '-o': 'octagon', '-y': 'pentagon',
    '-e': 'ellipse', '-z': 'cross', '-v': 'heart', '-x': 'cover', '-i': 'contain'
}

const effectArgs = {
    '-blur': 'blur', '-sepia': 'sepia', '-sharpen': 'sharpen',
    '-brighten': 'brighten', '-darken': 'darken', '-invert': 'invert',
    '-grayscale': 'grayscale', '-rotate90': 'rotate90', '-rotate180': 'rotate180',
    '-flip': 'flip', '-flop': 'flop', '-normalice': 'normalise',
    '-normalise': 'normalise', '-negate': 'negate', '-tint': 'tint'
}

const isUrl = (value = '') => /^https?:\/\/\S+$/i.test(value)
const safeUnlink = file => { try { if (file && fs.existsSync(file)) fs.unlinkSync(file) } catch {} }

const getContextInfo = msg => {
    const type = Object.keys(msg?.message || {})[0]
    return msg?.message?.extendedTextMessage?.contextInfo
        || msg?.message?.[type]?.contextInfo
        || {}
}

const unwrapMessage = message => {
    let current = message
    for (const wrapper of [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'documentWithCaptionMessage'
    ]) {
        if (current?.[wrapper]?.message) current = current[wrapper].message
    }
    return current || message
}

const mediaInfo = message => {
    const content = unwrapMessage(message)
    const type = Object.keys(content || {})[0] || ''
    const media = content?.[type] || {}
    return { content, type, media, mime: media.mimetype || '' }
}

const getQuotedSource = msg => {
    const context = getContextInfo(msg)
    if (!context.quotedMessage) return msg

    return {
        key: {
            remoteJid: msg.key?.remoteJid,
            fromMe: Boolean(context.participant && context.participant === msg.key?.participant),
            id: context.stanzaId,
            participant: context.participant
        },
        message: context.quotedMessage
    }
}

const downloadSource = async (conn, source) => {
    return downloadMediaMessage(
        source,
        'buffer',
        {},
        {
            logger,
            reuploadRequest: conn?.updateMediaMessage
                ? conn.updateMediaMessage.bind(conn)
                : undefined
        }
    )
}

const runProcess = (command, args) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `${command} terminó con código ${code}`))
    })
})

const isAnimatedWebp = buffer => Buffer.isBuffer(buffer)
    && buffer.length >= 32
    && (buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF')))

const buildFFmpegFilters = effects => {
    const W = 512
    const H = 512
    const filters = []
    const shape = effects.find(effect => effect.type === 'shape')?.value
    const effectList = effects.filter(effect => effect.type === 'effect').map(effect => effect.value)

    if (shape === 'cover') {
        filters.push(`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`)
    } else {
        filters.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`)
        filters.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`)
    }

    filters.push('format=rgba')

    for (const effect of effectList) {
        switch (effect) {
            case 'blur': filters.push('gblur=sigma=5'); break
            case 'sepia': filters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'); break
            case 'sharpen': filters.push('unsharp=5:5:1.0:5:5:0.0'); break
            case 'brighten': filters.push('eq=brightness=0.05'); break
            case 'darken': filters.push('eq=brightness=-0.05'); break
            case 'invert':
            case 'negate': filters.push('negate'); break
            case 'grayscale': filters.push('hue=s=0'); break
            case 'rotate90': filters.push('transpose=1'); break
            case 'rotate180': filters.push('rotate=PI'); break
            case 'flip': filters.push('hflip'); break
            case 'flop': filters.push('vflip'); break
            case 'normalise':
            case 'normalice': filters.push('normalize'); break
            case 'tint': filters.push('colorchannelmixer=1:0:0:0:0:0.5:0:0:0:0:0.5'); break
        }
    }

    if (shape === 'mirror') filters.push('hflip')

    if (shape && !['cover', 'contain', 'mirror', 'border', 'frame'].includes(shape)) {
        const cx = W / 2
        const cy = H / 2
        const r = Math.min(W, H) / 2
        let alphaExpr = ''

        switch (shape) {
            case 'circle': alphaExpr = `if(lte((X-${cx})*(X-${cx})+(Y-${cy})*(Y-${cy}),${r * r}),255,0)`; break
            case 'triangle': alphaExpr = `if(gte(Y,${H * 0.1})*lte(Y,${H * 0.9})*lte(abs(X-${cx}),((${H * 0.9}-Y)*0.6)),255,0)`; break
            case 'star': alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.25}+${W * 0.1}*cos(5*atan2(Y-${cy},X-${cx}))),255,0)`; break
            case 'hexagon': alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.4}*cos(PI/6)/cos(mod(atan2(Y-${cy},X-${cx}),PI/3)-PI/6)),255,0)`; break
            case 'diamond': alphaExpr = `if(lte(abs(X-${cx})+abs(Y-${cy}),${r}),255,0)`; break
            case 'wave': alphaExpr = `if(lte(abs(Y-(${cy}+${H * 0.05}*sin(X*0.05))),${H * 0.4}),255,0)`; break
            case 'octagon': alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.4}*cos(PI/8)/cos(mod(atan2(Y-${cy},X-${cx}),PI/4)-PI/8)),255,0)`; break
            case 'pentagon': alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.4}*cos(PI/5)/cos(mod(atan2(Y-${cy},X-${cx}),2*PI/5)-PI/5)),255,0)`; break
            case 'ellipse': alphaExpr = `if(lte(((X-${cx})*(X-${cx}))/(${(W * 0.45) ** 2})+((Y-${cy})*(Y-${cy}))/(${(H * 0.4) ** 2}),1),255,0)`; break
            case 'cross': alphaExpr = `if(gt(lte(abs(X-${cx}),${W * 0.15})*lte(abs(Y-${cy}),${H * 0.45})+lte(abs(Y-${cy}),${H * 0.15})*lte(abs(X-${cx}),${W * 0.45}),0),255,0)`; break
            case 'heart': alphaExpr = `if(lte(pow((X-${cx})/(${W * 0.3})*(X-${cx})/(${W * 0.3})+(Y-${cy})/(${H * 0.3})*(Y-${cy})/(${H * 0.3})-1,3)-((X-${cx})/(${W * 0.3})*(X-${cx})/(${W * 0.3}))*pow((Y-${cy})/(${H * 0.3}),3),0),255,0)`; break
            case 'roundrect':
                filters.push(`drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0:t=45`)
                break
        }

        if (alphaExpr) filters.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alphaExpr}'`)
    }

    if (shape === 'border') filters.push(`drawbox=x=0:y=0:w=${W}:h=${H}:color=white@0.9:t=10`)
    if (shape === 'frame') filters.push(`drawbox=x=15:y=15:w=${W - 30}:h=${H - 30}:color=white@0.7:t=8`)

    filters.push('format=yuva420p')
    return filters.join(',')
}

const createExif = (packname, author) => {
    const json = {
        'sticker-pack-id': `com.zapia.sticker.${Date.now()}`,
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        emojis: ['']
    }
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
    const exifAttr = Buffer.from([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ])
    const exif = Buffer.concat([exifAttr, jsonBuffer])
    exif.writeUIntLE(jsonBuffer.length, 14, 4)
    return exif
}

const addExif = async (webpBuffer, packname, author) => {
    try {
        const webpModule = await import('node-webpmux')
        const Image = webpModule.default?.Image || webpModule.Image
        if (!Image) return webpBuffer

        const image = new Image()
        await image.load(webpBuffer)
        image.exif = createExif(packname, author)
        return image.save(null)
    } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND' || String(error?.message || '').includes('node-webpmux')) {
            throw new Error('Falta instalar node-webpmux para guardar Pack y Autor en el sticker.')
        }
        throw error
    }
}

const listText = prefix => `ꕥ Lista de formas y efectos para *imagen*:

✦ *Formas:*
- -c circular
- -t triangular
- -s estrella
- -r esquinas redondeadas
- -h hexagonal
- -d diamante
- -f marco
- -b borde
- -w onda
- -m espejo
- -o octogonal
- -y pentagonal
- -e elíptica
- -z cruz
- -v corazón
- -x cover
- -i contain

✧ *Efectos:*
- -blur · -sepia · -sharpen
- -brighten · -darken · -invert
- -grayscale · -rotate90 · -rotate180
- -flip · -flop · -normalice · -negate · -tint

Ejemplo: *${prefix}sticker -c -blur Pack | Autor*`

const getMetadata = (msg, args, senderNumber = '') => {
    const botName = String(global.botName || global.stickerPack || global.packname || 'Zapia Stickers')
    const displayName = String(msg.pushName || 'usuario').replace(/^@+/, '').trim() || 'usuario'
    const defaultPack = `${botName} | @${displayName}`
    const defaultAuthor = `Programación de Dilan\n\nOwner: +${STICKER_OWNER_NUMBER}`
    const text = args.filter(arg => !arg.startsWith('-') && !isUrl(arg)).join(' ').replace(/-\w+/g, '').trim()
    const parts = text.split(/[•|]/).map(part => part.trim()).filter(Boolean)

    return {
        pack: parts[0] || defaultPack,
        author: parts[1] || defaultAuthor
    }
}

const sendSticker = async (conn, msg, buffer, pack, author) => {
    const withExif = await addExif(buffer, pack, author)
    return conn.sendMessage(msg.key.remoteJid, { sticker: withExif }, { quoted: msg })
}

export const handleSticker = async (conn, msg, options = {}) => {
    const prefix = options.prefix || global.prefix?.[0] || '/'
    const args = Array.isArray(options.args) ? options.args : []
    const reply = text => conn.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
    const commandText = `${prefix}${options.command || 'sticker'}`

    try {
        if (args[0]?.toLowerCase() === '-list') return reply(listText(prefix))

        if (options.all === true || args.some(arg => String(arg).trim().toLowerCase() === 'all')) {
            const chat = msg.key?.remoteJid
            const requesterNumber = await resolvePhoneFromMessage(conn, msg)
            const queued = (stickerMediaQueue.get(chat) || [])
                .filter(item => !item.senderNumber || item.senderNumber === requesterNumber)
                .sort((a, b) => a.createdAt - b.createdAt)

            if (queued.length === 0) {
                return reply('《✧》 No encontré imágenes pendientes tuyas. Envía las imágenes y luego usa *sticker all*.')
            }

            stickerMediaQueue.set(chat, [])
            const singleArgs = args.filter(arg => String(arg).toLowerCase() !== 'all')

            for (const item of queued) {
                await handleSticker(conn, item.msg, {
                    ...options,
                    args: singleArgs,
                    command: options.command || 'sticker'
                })
                await wait(2000)
            }
            return
        }

        const quoted = getQuotedSource(msg)
        const info = mediaInfo(quoted.message)
        const mime = info.mime.toLowerCase()
        const urlArg = args.find(isUrl)
        const argsWithoutUrl = args.filter(arg => arg !== urlArg)
        const senderNumber = await resolvePhoneFromMessage(conn, msg)
        const metadata = getMetadata(msg, argsWithoutUrl, senderNumber)
        const effects = argsWithoutUrl
            .map(arg => shapeArgs[arg] ? { type: 'shape', value: shapeArgs[arg] } : effectArgs[arg] ? { type: 'effect', value: effectArgs[arg] } : null)
            .filter(Boolean)

        const processBuffer = async (buffer, extension, animated = false) => {
            const inputPath = path.join(TMP_DIR, `sticker-input-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`)
            fs.writeFileSync(inputPath, buffer)
            const outputPath = path.join(TMP_DIR, `sticker-output-${Date.now()}-${Math.random().toString(16).slice(2)}.webp`)

            try {
                const filters = buildFFmpegFilters(effects)
                const ffmpegArgs = animated
                    ? ['-y', '-i', inputPath, '-vf', filters, '-an', '-t', '20', '-c:v', 'libwebp_anim', '-preset', 'picture', '-compression_level', '6', '-q:v', '70', '-loop', '0', outputPath]
                    : ['-y', '-i', inputPath, '-vf', filters, '-an', '-frames:v', '1', '-c:v', 'libwebp', '-q:v', '70', outputPath]

                await runProcess('ffmpeg', ffmpegArgs)
                const result = fs.readFileSync(outputPath)
                await sendSticker(conn, msg, result, metadata.pack, metadata.author)
            } finally {
                safeUnlink(inputPath)
                safeUnlink(outputPath)
            }
        }

        if (urlArg) {
            const response = await fetch(urlArg)
            if (!response.ok) return reply('《✧》 No pude descargar ese archivo desde la URL.')
            const buffer = Buffer.from(await response.arrayBuffer())
            const urlPath = urlArg.split('?')[0].toLowerCase()
            const extension = path.extname(urlPath).replace('.', '') || 'bin'
            if (!['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension)) {
                return reply('《✧》 La URL debe terminar en una imagen o video compatible.')
            }
            if (extension === 'webp' && isAnimatedWebp(buffer) && effects.length === 0) {
                return sendSticker(conn, msg, buffer, metadata.pack, metadata.author)
            }
            return processBuffer(buffer, extension, ['gif', 'mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension))
        }

        if (/image|video|gif|webp/.test(mime)) {
            if (info.media.seconds && Number(info.media.seconds) > 20) {
                return reply('《✧》 El video no puede durar más de 20 segundos.')
            }

            const buffer = await downloadSource(conn, quoted)
            if (/webp/.test(mime) && isAnimatedWebp(buffer) && effects.length === 0) {
                return sendSticker(conn, msg, buffer, metadata.pack, metadata.author)
            }

            const extension = /video/.test(mime) ? 'mp4' : /gif/.test(mime) ? 'gif' : /webp/.test(mime) ? 'webp' : /png/.test(mime) ? 'png' : 'jpg'
            return processBuffer(buffer, extension, /video|gif/.test(mime) || isAnimatedWebp(buffer))
        }

        return reply(`《✧》 Envía o responde a una imagen, video, sticker o URL.
Usa *${commandText} -list* para ver las formas y efectos.`)
    } catch (error) {
        console.error('[Sticker]', error)
        return reply(`《✧》 No se pudo crear el sticker: ${error.message}`)
    }
}
