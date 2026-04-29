import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import App from './App'
import { useStore } from '@/store'
import { registerChartJs } from './components/charts/registerChartJs'

registerChartJs()

// Allow callers to deep-link to a specific run via `?run=<id>`. Used by
// the nebo-cloud router to embed the daemon UI in an iframe scoped to
// one run. Set BEFORE App renders so the auto-select-latest logic in
// the store doesn't override us.
const initialRun = new URLSearchParams(window.location.search).get('run')
if (initialRun) {
  useStore.getState().selectRun(initialRun)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
