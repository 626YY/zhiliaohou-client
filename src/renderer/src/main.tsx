import ThemeAtmosphere from './components/ThemeAtmosphere'
import { ENTRANCE_EFFECT_CSS } from '@shared/entranceEffects'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import {ConfigurationProvider} from './lib/configurationLevel'
import './index.css'
import { applyTheme } from './lib/theme'
import { WIDGET_SKIN_CSS, ENTRANCE_SKIN_CSS } from '@shared/widgetSkins'
import { COUNTDOWN_DECORATION_CSS } from '@shared/countdownFrame'

applyTheme()
const skinStyles = document.createElement('style')
skinStyles.textContent = WIDGET_SKIN_CSS + ENTRANCE_SKIN_CSS + ENTRANCE_EFFECT_CSS + COUNTDOWN_DECORATION_CSS
document.head.appendChild(skinStyles)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <ThemeAtmosphere />
      <ConfigurationProvider><App /></ConfigurationProvider>
    </HashRouter>
  </React.StrictMode>
)
