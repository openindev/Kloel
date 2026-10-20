import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router, routerRenderFuture } from './routes'
import { engineSession } from './services/engine/session'
import { startEngineProjection } from './services/casca/data'
import { registerEngineLoaders } from './services/casca/loaders'

registerEngineLoaders()
const stopProjection = startEngineProjection()
void engineSession.refresh()
const revalidate = () => { if (document.visibilityState === 'visible') void engineSession.revalidateOnFocus() }
window.addEventListener('focus', revalidate)
document.addEventListener('visibilitychange', revalidate)
if (import.meta.hot) import.meta.hot.dispose(() => {
  stopProjection()
  window.removeEventListener('focus', revalidate)
  document.removeEventListener('visibilitychange', revalidate)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} future={routerRenderFuture} />
  </StrictMode>,
)

// Integration tests authenticate through the same HTTP/session path as users.
