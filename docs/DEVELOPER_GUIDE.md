# 🌿 Motiva - Guia Rápido de Desenvolvimento

> **Monitoramento Remoto de Vegetação — São Paulo**

## 🚀 Começar

```bash
# Nenhuma instalação necessária!
# Abra simplesmente no navegador:
open index.html
```

## 📁 Estrutura do Projeto

```
js/
├── main.js                              # Orquestrador central
├── dashboards/                          # Cada dashboard é independente
│   ├── monitor/                         # 🗺️ Monitor
│   │   ├── monitor-map.js
│   │   └── monitor-dashboard.js
│   ├── grass-analysis/                  # 🌾 Análise de Grama
│   │   └── grass-analysis.js
│   └── ai-prediction/                   # 🤖 Previsão IA
│       └── ai-prediction.js
└── shared/                              # Módulos compartilhados
    ├── weather.js                       # API Open-Meteo
    ├── locations.js                     # Dados de pontos
    ├── points-store.js                  # Gerenciador de estado
    └── grass-types.js                   # Catálogo de espécies

css/
├── shared/
│   └── base.css                         # Estilos compartilhados
└── dashboards/
    ├── monitor/
    │   └── monitor.css
    ├── grass-analysis/
    │   └── grass-analysis.css
    └── ai-prediction/
        └── ai-prediction.css
```

## 🎯 Os Três Dashboards

### 1️⃣ Monitor (🗺️)
**Arquivo Principal**: `js/dashboards/monitor/monitor-map.js`  
**Estilos**: `css/dashboards/monitor/monitor.css`

Mostra um mapa interativo com:
- Mapa Leaflet com marcadores coloridos por risco
- Sidebar com cards dos pontos monitorados
- Stats (temperatura média, vento máx, pontos em alto risco)
- Modal para adicionar novos pontos customizados

### 2️⃣ Análise de Grama (🌾)
**Arquivo Principal**: `js/dashboards/grass-analysis/grass-analysis.js`  
**Estilos**: `css/dashboards/grass-analysis/grass-analysis.css`

Análise de altura de grama via Canvas:
- Upload de imagem (drag & drop ou clique)
- Análise HSV com morphological operations
- Detecção de altura via contours
- Visualização de máscara + resultado
- Stats: críticos, atenção, ok, altura máxima

### 3️⃣ Previsão IA (🤖)
**Arquivo Principal**: `js/dashboards/ai-prediction/ai-prediction.js`  
**Estilos**: `css/dashboards/ai-prediction/ai-prediction.css`

Motor de predição de corte baseado em regras:
- Seleciona um ponto monitorado
- Escolhe tipo de grama (multiplier de crescimento)
- Insere altura atual
- Gera previsão com:
  - Taxa de crescimento (cm/dia)
  - Dias até atingir atenção/crítico
  - Gráfico de projeção (60 dias)
  - Explicação da IA

## 🔗 Como Adicionar um Novo Dashboard

1. **Criar pasta**:
   ```
   js/dashboards/meu-dashboard/
   css/dashboards/meu-dashboard/
   ```

2. **Criar arquivo JS**:
   ```javascript
   // js/dashboards/meu-dashboard/meu-dashboard.js
   export function initMeuDashboard() {
     // sua lógica aqui
   }
   ```

3. **Criar arquivo CSS**:
   ```css
   /* css/dashboards/meu-dashboard/meu-dashboard.css */
   .meu-dashboard-panel {
     /* seus estilos */
   }
   ```

4. **Atualizar main.js**:
   ```javascript
   import { initMeuDashboard } from "./dashboards/meu-dashboard/meu-dashboard.js";
   
   function init() {
     // ...
     initMeuDashboard();
   }
   ```

5. **Atualizar index.html**:
   ```html
   <link rel="stylesheet" href="css/dashboards/meu-dashboard/meu-dashboard.css" />
   
   <!-- Criar nova aba -->
   <button class="tab-btn" data-tab="meu-dashboard">📊 Meu Dashboard</button>
   
   <!-- Criar novo painel -->
   <main class="app-layout tab-panel" id="tab-meu-dashboard">
     <section class="meu-dashboard-panel">
       <!-- seu HTML -->
     </section>
   </main>
   ```

## 🧠 Padrões de Codificação

### Módulos Compartilhados
Qualquer coisa reutilizável vai em `js/shared/`:

```javascript
// Exemplo: novo arquivo shared
// js/shared/meu-utilitario.js
export function meuUtilitario() { /* ... */ }

// Usar em qualquer lugar:
import { meuUtilitario } from "../../shared/meu-utilitario.js";
```

### Importação de Estilos
CSS específico de dashboard vai em seu próprio arquivo:

```css
/* css/dashboards/meu-dashboard/meu-dashboard.css */
.meu-dashboard-panel { /* ... */ }
.meu-dashboard-button { /* ... */ }
```

Não mixe estilos de diferentes dashboards!

### Nomes Descritivos
- **JS**: `monitor-map.js`, não `map.js`
- **CSS**: `grass-analysis.css`, não `grass.css`
- **HTML**: `#tab-predict`, não `#tab3`

## 🎨 Variáveis CSS Disponíveis

Definidas em `css/shared/base.css`:

```css
--bg:         #15121c
--bg-surface: #1e1a29
--bg-card:    #251f33
--border:     #383047
--green:      #9b5de5
--green-lit:  #cba6f7
--amber:      #f2a61f
--red:        #ff4d6d
--text-primary:   #f2eefb
--text-secondary: #b6adca
--text-muted:     #7a7091
--radius-md:  8px
--shadow-card: 0 1px 3px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.3)
```

Use sempre as variáveis para consistência!

## 🔧 APIs Compartilhadas

### `weather.js`
```javascript
import { fetchWeather, decodeWeatherCode, weatherIcon } from "../shared/weather.js";

const weather = await fetchWeather(lat, lon);
// Retorna: { temperature, windspeed, precipProb, humidity, risk, label, icon }
```

### `points-store.js`
```javascript
import { registerPoint, getAllPoints, onPointsChange } from "../shared/points-store.js";

registerPoint(location, weather);           // Registrar ponto
const allPoints = getAllPoints();            // Listar todos
onPointsChange(callback);                    // Se inscrever em mudanças
```

### `grass-types.js`
```javascript
import { GRASS_TYPES, getGrassType } from "../shared/grass-types.js";

const type = getGrassType("bermuda");
// Retorna: { name, growthMultiplier, thresholdAtencao, thresholdCritico, description }
```

## 📊 Fluxo de Dados

```
main.js (inicializa tudo)
  ├─→ fetchWeather(lat, lon)              [weather.js]
  ├─→ registerPoint(location, weather)    [points-store.js]
  ├─→ onPointsChange(callback)            [points-store.js]
  ├─→ getGrassType(id)                    [grass-types.js]
  └─→ initMap(), initDashboard(), ...
```

## 🐛 Debugging

Abra o DevTools (F12) e procure por:
- `[VegWatch]` — logs principais
- Erros de import — verifique caminhos relativos
- Estilos não aplicados — verifique CSS modular

## 📚 Documentação

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Estrutura de JS
- **[CSS_STRUCTURE.md](CSS_STRUCTURE.md)** — Organização de CSS
- **[BEFORE_AFTER.md](BEFORE_AFTER.md)** — Comparação antes/depois

## ✨ Stack

- **HTML5** — Semântico
- **CSS3** — CSS Variables, Grid, Flexbox
- **JavaScript ES6+** — Modules, async/await
- **Leaflet** — Mapas interativos
- **Open-Meteo API** — Dados meteorológicos
- **Canvas API** — Análise de imagens

## 🚀 Deploy

O projeto é totalmente client-side. Para deploy:

```bash
# Copiar pasta inteira para o servidor
scp -r Challenge/* usuario@servidor.com:/var/www/motiva/
```

Compatível com GitHub Pages, Netlify, Vercel, etc.

---

**Pronto para começar? Abra `index.html` e explore!** 🎉
