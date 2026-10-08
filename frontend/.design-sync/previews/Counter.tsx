import { Counter } from 'cep-frontend'

export const Tones = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Counter used={42} max={160} />
    <Counter used={150} max={160} />
    <Counter used={160} max={160} />
    <Counter used={1240} max={2000} />
  </div>
)
