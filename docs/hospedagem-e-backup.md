# Guia de Hospedagem, Infraestrutura e Backup

> Manual técnico completo para implantação, infraestrutura de rede, túneis HTTPS, procedimentos de backup e recuperação de desastres do **Scelta** para o dia da assembleia.

---

## Sumário

1. [Visão Geral de Arquitetura](#1-vis%C3%A3o-geral-de-arquitetura)
2. [Opção 1 — Servidor Local na Igreja com Túnel HTTPS](#2-op%C3%A7%C3%A3o-1--servidor-local-na-igreja-com-t%C3%BAnel-https-recomendada)
3. [Opção 2 — Nuvem (PaaS / Cloud Gratuita)](#3-op%C3%A7%C3%A3o-2--nuvem-paas--cloud-gratuita)
4. [Procedimentos de Backup e Restauração do PostgreSQL](#4-procedimentos-de-backup-e-restaura%C3%A7%C3%A3o-do-postgresql)
5. [Checklist Completo de Véspera e do Dia da Assembleia](#5-checklist-completo-de-v%C3%A9spera-e-do-dia-da-assembleia)

---

## 1. Visão Geral de Arquitetura

O Scelta é composto por:
- **Banco de Dados**: PostgreSQL 16+ com extensões padrão (Drizzle ORM com migrações automáticas versionadas em `packages/db/drizzle/`).
- **Backend API**: Node.js 20+ Fastify + Socket.IO (`apps/api`), porta padrão `3333`.
- **Frontend SPA**: React 18 + Vite + Tailwind CSS (`apps/web`), porta padrão `5173` (ou empacotado como estático servido por Nginx).
- **Endereço Público (`PUBLIC_URL`)**: Obrigatório para que os QR Codes e URLs curtas gerados nos cartões impressos apontem com exatidão para o endereço público acessível pelos celulares dos membros na assembleia.

---

## 2. Opção 1 — Servidor Local na Igreja com Túnel HTTPS (Recomendada)

Ideal para locais onde a conexão de internet da igreja pode oscilar, permitindo que a mesa opere mesmo com link externo lento ou instável.

### 2.1 Requisitos Mínimos
- Notebook ou desktop do operador com Windows 11, macOS ou Linux (Ubuntu 22.04+).
- 8 GB de memória RAM e processador quad-core moderno.
- Docker e Docker Compose instalados.

### 2.2 Configuração do Arquivo `.env`
No diretório raiz do projeto, crie ou edite o arquivo `.env`:

```env
# Banco de dados local
DATABASE_URL=postgres://scelta:scelta_secret@localhost:5432/scelta
POSTGRES_USER=scelta
POSTGRES_PASSWORD=scelta_secret
POSTGRES_DB=scelta

# URLs da aplicação
PORT=3333
PUBLIC_URL=https://assembleia.suaigreja.org.br
CORS_ORIGIN=https://assembleia.suaigreja.org.br

# Conta inicial do administrador
ADMIN_EMAIL=pastor@igreja.com.br
ADMIN_PASSWORD=SenhaForteAssembleia2026!
SESSION_SECRET=chave_secreta_aleatoria_com_pelo_menos_32_caracteres_hex
```

### 2.3 Subindo a Aplicação via Docker Compose
Execute no terminal:

```bash
docker compose up -d
```

O comando iniciará o PostgreSQL, a API Fastify e o container web. Ao iniciar, a API executa automaticamente todas as migrações Drizzle pendentes (`runMigrations(db)`).

### 2.4 Expondo a Aplicação via Túnel HTTPS Seguro
Os navegadores móveis nos smartphones exigem HTTPS para utilizar recursos modernos de WebSocket e segurança de cookies. Utilize uma das soluções abaixo:

#### A) Cloudflare Tunnel (`cloudflared`) — Recomendado (Estável e Gratuito)
1. Instale o utilitário oficial:
   ```bash
   # Windows (via winget ou choco)
   winget install Cloudflare.cloudflared
   ```
2. Inicie o túnel temporário rápido:
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
3. O terminal fornecerá uma URL pública HTTPS (ex.: `https://exemplo-random.trycloudflare.com`).
4. Atualize o valor de `PUBLIC_URL` no `.env` com esta URL gerada e reinicie a API:
   ```bash
   docker compose restart api
   ```

#### B) Tailscale Funnel / ngrok
Caso utilize `ngrok`:
```bash
ngrok http 5173
```
Copie a URL `https://xxxx.ngrok-free.app` e preencha em `PUBLIC_URL`.

### 2.5 Verificação de Integridade de Origem
Acesse o painel do administrador (`/admin/salas`). O Scelta verifica automaticamente se a URL pela qual você acessou coincide com o `PUBLIC_URL` configurado. Se houver divergência, um aviso destacado no topo do painel alertará:
> *"Aviso: O endereço configurado em PUBLIC_URL difere do endereço atual do navegador. Os cartões e QR Codes gerados podem apontar para um endereço inacessível."*

---

## 3. Opção 2 — Nuvem (PaaS / Cloud Gratuita)

Excelente para quem prefere não se preocupar com máquina local ou roteadores físicos na igreja, rodando em provedores com SSL automático.

### 3.1 Provedores Recomendados
- **Banco de Dados Postgres Gerenciado**: [Neon](https://neon.tech) ou [Supabase](https://supabase.com).
- **Aplicação (Web + API)**: [Render](https://render.com), [Railway](https://railway.app) ou [Fly.io](https://fly.io).

### 3.2 Variáveis de Ambiente no Painel da Nuvem
Configure as seguintes variáveis no serviço da API e Web:

| Variável | Valor Exemplo | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `production` | Modo de produção do Node.js |
| `DATABASE_URL` | `postgresql://user:pass@ep-xyz.neon.tech/scelta?sslmode=require` | String de conexão SSL com pooling do Postgres |
| `PUBLIC_URL` | `https://scelta-votacao.onrender.com` | Endereço público HTTPS da aplicação |
| `CORS_ORIGIN` | `https://scelta-votacao.onrender.com` | Origem autorizada para requisições cross-origin |
| `ADMIN_EMAIL` | `conselho@igreja.org.br` | E-mail da conta mestra da mesa |
| `ADMIN_PASSWORD` | `SegredoForteDeEleicao2026!` | Senha de acesso do administrador |
| `SESSION_SECRET` | `c3b09f7a6e4d2...` | Hash de 64 caracteres para encriptação de sessões |

### 3.3 Verificação de Saúde e Inicialização Automática
Na subida da API em nuvem, a aplicação executa o bootstrap de schema e migrações. Para testar o status do deploy, execute uma chamada HTTP:
- `GET https://scelta-votacao.onrender.com/v1/health` $\rightarrow$ Retorna `{"status":"ok"}`.
- `GET https://scelta-votacao.onrender.com/v1/config` $\rightarrow$ Retorna `{"publicUrl":"https://scelta-votacao.onrender.com"}`.

---

## 4. Procedimentos de Backup e Restauração do PostgreSQL

A integridade do livro de auditoria e das apurações exige backups regulares antes, durante e após a votação.

### 4.1 Comandos de Backup com `pg_dump`

#### A) Backup Inicial da Véspera (Pré-Assembleia — Estrutura e Membros Cadastrados)
Antes de abrir as salas para o plenário, gere a cópia de segurança contendo o rol de membros já validado:

```bash
# Servidor local (Docker)
docker exec -t escolha-postgres pg_dump -U scelta -F c -b -v -f /tmp/backup_pre_assembleia.dump scelta
docker cp escolha-postgres:/tmp/backup_pre_assembleia.dump ./backups/backup_pre_assembleia_$(date +%Y%m%d_%H%M).dump

# Servidor Remoto / Neon / Provedor Cloud
pg_dump "postgres://user:pass@host:5432/scelta?sslmode=require" -F c -b -v -f ./backups/backup_pre_assembleia_$(date +%Y%m%d).dump
```

#### B) Backup Imediato Pós-Assembleia (Com Escrutínios e Auditoria Criptográfica)
Logo após encerrar as votações do dia:

```bash
pg_dump "postgres://scelta:scelta_secret@localhost:5432/scelta" \
  -F c -b -v -f ./backups/scelta_assembleia_concluida_$(date +%Y%m%d_%H%M).dump
```

### 4.2 Restauração de Desastre com `pg_restore` do Zero
Caso seja necessário restaurar o banco de dados em uma máquina limpa ou após falha grave de hardware:

1. Crie uma nova base de dados limpa:
   ```sql
   DROP DATABASE IF EXISTS scelta_recovery;
   CREATE DATABASE scelta_recovery;
   ```
2. Execute a restauração do arquivo binário `.dump`:
   ```bash
   pg_restore -U scelta -d scelta_recovery -v --no-owner --no-privileges ./backups/scelta_assembleia_concluida_20261123.dump
   ```
3. Aponte o `DATABASE_URL` para `scelta_recovery` e reinicie a API. O Scelta restabelece o estado integral da assembleia, mantendo o histórico de todas as rodadas, participações e logs encadeados.

### 4.3 Exportação dos Logs Inapagáveis
Ao término da assembleia, além do backup binário do banco:
1. Abra a tela de cada sala na aba **Resultado**.
2. Clique no painel **Auditoria** e selecione **"Verificar Cadeia de Integridade"**.
3. Confirme o selo verde: *"Cadeia SHA-256 válida da origem (GENESIS) até o encerramento"*.
4. Clique em **Imprimir Relatório de Auditoria** ou salve em PDF para anexar formalmente à Ata do Conselho da Igreja.

---

## 5. Checklist Completo de Véspera e do Dia da Assembleia

### 1 Dia Antes da Assembleia (Véspera)
- [ ] **Importação do Rol**: Arquivo CSV de membros importado e conferido no menu Membros (comunicantes vs sócios ativos de UPA/UMP).
- [ ] **Configuração da Sala**: Salas criadas com o quórum correto e número de vagas ($N$) estipulado pelo Conselho.
- [ ] **Teste de Túnel / URL Pública**: `PUBLIC_URL` acessível via celular conectado na rede móvel 4G/5G (fora do Wi-Fi).
- [ ] **Impressão dos Cartões A4**: Folhas com 8 cartões impressas, sem cabeçalhos de navegador e sem cortes no QR Code. Cartões cortados e organizados por ordem alfabética.
- [ ] **Teste Prático com 3 Celulares**:
  - 1 celular Android e 1 iPhone lendo o QR Code do cartão.
  - Teste de login na home digitando apenas o código da sala de 6 letras.
  - Depósito de voto de teste em sala de testes e verificação da computação anônima.
- [ ] **Backup Inicial**: Realização do backup `backup_pre_assembleia.dump` e armazenamento em pendrive externo.

### No Dia da Assembleia (30 Minutos Antes)
- [ ] **Projetor / Segunda Tela**: Computador da mesa conectado ao telão via HDMI/Cabo, exibindo `/telao/:salaId` em tela cheia (F11) com o QR Code de recepção gigante.
- [ ] **Conexão dos Mesários**: Notebooks dos mesários abertos na aba **Conduzir** da sala.
- [ ] **Kit Físico de Urna**: Urna física posicionada na mesa com cédulas de papel em branco e canetas para eleitores sem celular ou com dificuldades técnicas.
- [ ] **Revisão de Som e Avisos**: Orientar o plenário no momento da abertura:
  - *"Quem usar leitor de QR Code pelo WhatsApp/Instagram, toque nos 3 pontinhos para Abrir no Navegador (Chrome ou Safari)"*.
  - *"Quem não tiver leitor de QR Code, digite no navegador o código da sala exibido no telão"*.

### Ao Encerrar a Assembleia
- [ ] **Encerramento Formal das Salas**: Todas as salas marcadas como `Encerrada` no sistema.
- [ ] **Revelação no Telão**: Telão atualizado com a comemoração oficial dos oficiais eleitos.
- [ ] **Auditoria SHA-256**: Validação da cadeia criptográfica executada e impressa.
- [ ] **Backup Final de Segurança**: Extração do dump completo do PostgreSQL salvo na nuvem e em pendrive do Secretário do Conselho.