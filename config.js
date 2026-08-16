import { watchFile, unwatchFile } from 'fs'
import chalk from 'chalk'
import { fileURLToPath } from 'url'

// CONFIGURACIÓN BÁSICA PARA BOT DE WHATSAPP
// ==========================================

global.owner = [
  ['50662907002'], ['50661410344'], // Número principal (owner real)
  ['225009696014584']  // Número lid
]

global.dev = 'Dy' // Tu nombre o alias
global.botName = 'Bot_2' // Nombre de tu bot
global.prefix = ['×'] // Prefijo por defecto
global.subprefix = ['π']
global.banner = 'https://files.catbox.moe/u2viza.jpg' // Banner del menú 

// FUNCIÓN DE RECARGA AUTOMÁTICA
const file = fileURLToPath(import.meta.url)
watchFile(file, () => {
  unwatchFile(file)
  console.log(chalk.cyan("Configuración actualizada"))
  import(`${file}?update=${Date.now()}`)
})
