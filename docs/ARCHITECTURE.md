# Motiva - Estrutura do Projeto

## Organização Revisada

O projeto foi reorganizado em uma estrutura modular com **3 dashboards independentes** e **módulos compartilhados**.

### 📂 Estrutura de Pastas

```
Challenge/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── main.js (orquestrador central)
│   │
│   ├── shared/ (módulos compartilhados por todos os dashboards)
│   │   ├── weather.js          → Fetch de dados meteorológicos (Open-Meteo API)
│   │   ├── locations.js        → Pontos geográficos de monitoramento
│   │   ├── points-store.js     → Registro em memória de pontos + listeners
│   │   └── grass-types.js      → Catálogo de espécies de grama (multipliers, thresholds)
│   │
│   └── dashboards/ (cada dashboard é independente)
│       │
│       ├── monitor/ (🗺️ Mapa de Monitoramento)
│       │   ├── monitor-map.js           → Inicialização do Leaflet, markers, popups
│       │   └── monitor-dashboard.js     → Cards de pontos, stats, badges
│       │
│       ├── grass-analysis/ (🌾 Análise de Grama)
│       │   └── grass-analysis.js        → Análise Canvas HSV, detecção de altura
│       │
│       └── ai-prediction/ (🤖 Previsão IA)
│           └── ai-prediction.js         → Motor de predição, cálculo de taxas
│
├── fernaodias.png
├── fernaodias2.png
└── fernaodias3.png
```

---

## 🎯 Responsabilidades por Módulo

### **shared/** (Camada compartilhada)
Módulos utilitários e data stores usados por múltiplos dashboards.

| Arquivo | Responsabilidade |
|---------|-----------------|
| `weather.js` | Busca weather data via Open-Meteo, decodifica códigos WMO, calcula risk |
| `locations.js` | Exporta array de 10 pontos padrão de São Paulo |
| `points-store.js` | Map em memória de pontos + sistema de listeners para reatividade |
| `grass-types.js` | Catálogo de espécies (multipliers de crescimento, thresholds críticos) |

### **dashboards/monitor/** (Monitor)
Painel de mapa + listagem de pontos monitorados.

| Arquivo | Responsabilidade |
|---------|-----------------|
| `monitor-map.js` | Leaflet setup, marker management, flyTo, custom point flow |
| `monitor-dashboard.js` | Renderização de cards, stats, badges, atualização de timestamp |

### **dashboards/grass-analysis/** (Análise de Grama)
Upload de imagens + análise de altura via Canvas API.

| Arquivo | Responsabilidade |
|---------|-----------------|
| `grass-analysis.js` | HSV masking, ROI, morphological ops, bounding boxes, renderização dos resultados |

### **dashboards/ai-prediction/** (Previsão IA)
Motor de predição de corte baseado em heurísticas.

| Arquivo | Responsabilidade |
|---------|-----------------|
| `ai-prediction.js` | Cálculo de taxa de crescimento, projeção de datas, gráfico SVG |

---

## 🔗 Fluxo de Importações

```
main.js (orquestrador)
  ├─→ monitor/
  │    ├─→ monitor-map.js
  │    │    └─→ shared/ (grass-types.js via grass-analysis)
  │    └─→ monitor-dashboard.js
  │
  ├─→ grass-analysis/
  │    └─→ grass-analysis.js
  │         ├─→ monitor/ (para renderizar no mapa)
  │         ├─→ shared/points-store.js
  │         └─→ shared/grass-types.js
  │
  ├─→ ai-prediction/
  │    └─→ ai-prediction.js
  │         ├─→ shared/points-store.js
  │         └─→ shared/grass-types.js
  │
  └─→ shared/
       ├─→ weather.js
       ├─→ locations.js
       └─→ points-store.js
```

---

## 📝 Nomes Descritivos

Todos os arquivos foram renomeados para serem mais descritivos e evitar ambiguidade:

| Arquivo antigo | Arquivo novo | Pasta |
|---|---|---|
| `map.js` | `monitor-map.js` | `dashboards/monitor/` |
| `dashboard.js` | `monitor-dashboard.js` | `dashboards/monitor/` |
| `grass.js` | `grass-analysis.js` | `dashboards/grass-analysis/` |
| `prediction.js` | `ai-prediction.js` | `dashboards/ai-prediction/` |
| `grass-types.js` | `grass-types.js` | `shared/` |
| `weather.js` | `weather.js` | `shared/` |
| `locations.js` | `locations.js` | `shared/` |
| `points-store.js` | `points-store.js` | `shared/` |

---

## ✨ Benefícios desta Arquitetura

✅ **Modularidade** — Cada dashboard é totalmente independente  
✅ **Reutilização** — Módulos shared evitam duplicação  
✅ **Clareza** — Nomes descritivos indicam responsabilidade  
✅ **Escalabilidade** — Fácil adicionar novos dashboards  
✅ **Manutenibilidade** — Organização lógica por funcionalidade  
✅ **Imports claros** — Fácil rastrear dependências  

---

## 🚀 Como Adicionar um Novo Dashboard

1. Crie uma nova pasta em `js/dashboards/seu-dashboard/`
2. Implemente `seu-dashboard.js` com função `initSeuDashboard()`
3. Importe em `main.js`: `import { initSeuDashboard } from "./dashboards/seu-dashboard/seu-dashboard.js"`
4. Chame em `init()`: `initSeuDashboard()`
5. Compartilhe dados via `shared/points-store.js` se necessário

---

## 📋 Index.html

Agora carrega apenas **um módulo** (main.js), que gerencia todas as dependências via imports ES6:

```html
<script type="module" src="js/main.js"></script>
```

Todos os outros scripts são carregados dinamicamente pelo sistema de módulos do navegador.
