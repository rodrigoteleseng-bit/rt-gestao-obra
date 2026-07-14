#!/usr/bin/env node
// Roda UMA VEZ, localmente (nunca no GitHub Actions), pra gerar o refresh token
// que autoriza o backup semanal a gravar no Google Drive da sua própria conta
// pessoal. Contas de serviço do Google não têm cota de armazenamento própria
// em contas pessoais/gratuitas, por isso a autenticação é feita como você
// mesmo, não como uma conta de serviço — ver docs/backup-setup.md.
//
// Uso: GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/gerar-token-drive.js
import { createServer } from 'node:http'
import { google } from 'googleapis'

const PORTA = 53682
const REDIRECT_URI = `http://localhost:${PORTA}/callback`

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('Defina GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET antes de rodar este script.')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)
const urlAutorizacao = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
})

console.log('\nAbra este link no navegador e faça login com a conta Google onde quer guardar os backups:\n')
console.log(urlAutorizacao)
console.log('\nAguardando você autorizar…\n')

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI)
  const code = url.searchParams.get('code')
  if (url.pathname !== '/callback' || !code) {
    res.writeHead(404); res.end(); return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<h1>Autorizado! Pode fechar esta aba e voltar ao terminal.</h1>')
  servidor.close()

  const { tokens } = await oauth2Client.getToken(code)
  if (!tokens.refresh_token) {
    console.error('\nNão veio refresh_token — revogue o acesso do app em myaccount.google.com/permissions e rode este script de novo (o Google só entrega o refresh_token na primeira autorização).')
    process.exit(1)
  }
  console.log('\nGOOGLE_OAUTH_REFRESH_TOKEN (copie isso pro secret do GitHub):\n')
  console.log(tokens.refresh_token)
  console.log('')
  process.exit(0)
})

servidor.listen(PORTA)
