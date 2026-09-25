// Starts the Django dev server with the backend's own virtualenv on Windows or Unix: .claude/launch.json runs this
// through node, which every machine that runs the frontend already has, instead of naming a platform-specific interpreter.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const backend = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'backend')
const candidates = [join(backend, '.venv', 'Scripts', 'python.exe'), join(backend, '.venv', 'bin', 'python')]
const python = candidates.find((path) => existsSync(path))
if (!python) {
  console.error('No virtualenv found at backend/.venv (looked for ' + candidates.join(' and ') + ')')
  process.exit(1)
}

const child = spawn(python, ['manage.py', 'runserver', '8000', '--noreload', ...process.argv.slice(2)], { cwd: backend, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 1))
