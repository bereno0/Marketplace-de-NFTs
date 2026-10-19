import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { backendConfigurationError, backendMode } from './backend'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
})

async function startApp() {
  const root = createRoot(document.getElementById('root')!)
  if (backendConfigurationError) {
    root.render(
      <div className="status-card error" role="alert">
        {backendConfigurationError}
      </div>,
    )
    return
  }

  // Inicie o MSW antes de renderizar: assim, as primeiras chamadas à API já são interceptadas.
  if (backendMode === 'mock') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledFrame: 'bypass' })
  }

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void startApp()
