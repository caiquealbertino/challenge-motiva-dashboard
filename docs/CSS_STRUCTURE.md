# Motiva - Estrutura de HTML e CSS

## 📁 Nova Organização

### CSS - Modular por Dashboard

```
css/
├── shared/
│   └── base.css                      ← Estilos compartilhados
│       ├── Variáveis CSS (cores, fontes, shadows)
│       ├── Resets e layout base
│       ├── Header e navegação
│       ├── Abas (tabs)
│       ├── Badges
│       ├── Botões (primary, secondary)
│       └── Modal (estrutura e overlay)
│
└── dashboards/
    ├── monitor/
    │   └── monitor.css              ← Estilos do Monitor
    │       ├── Mapa (Leaflet)
    │       ├── Sidebar
    │       ├── Cards de pontos
    │       ├── Stats
    │       └── Legend
    │
    ├── grass-analysis/
    │   └── grass-analysis.css        ← Estilos da Análise de Grama
    │       ├── Upload zone
    │       ├── Grass examples
    │       ├── Canvas (máscara + resultado)
    │       └── Stats (críticos, atenção, ok)
    │
    └── ai-prediction/
        └── ai-prediction.css         ← Estilos da Previsão IA
            ├── Formulário de predição
            ├── Cards de resultados
            ├── Gráfico de projeção
            └── Explicação da IA
```

### HTML - Estrutura Base Simplificada

```html
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <!-- Meta tags -->
    <!-- Leaflet CSS -->
    <!-- Google Fonts -->
    
    <!-- Shared CSS (base.css) -->
    <link rel="stylesheet" href="css/shared/base.css" />
    
    <!-- Dashboard CSS (cada aba carrega seu CSS) -->
    <link rel="stylesheet" href="css/dashboards/monitor/monitor.css" />
    <link rel="stylesheet" href="css/dashboards/grass-analysis/grass-analysis.css" />
    <link rel="stylesheet" href="css/dashboards/ai-prediction/ai-prediction.css" />
</head>
<body>
    <!-- Header e Tabs (mesmo para todas as abas) -->
    <header class="app-header">
        <!-- navegação, badges, timestamp -->
    </header>

    <!-- Aba Monitor -->
    <main class="app-layout tab-panel active" id="tab-monitor">
        <section class="map-section"><!-- mapa --></section>
        <aside class="sidebar"><!-- cards --></aside>
    </main>

    <!-- Modal do Monitor -->
    <div class="modal-overlay hidden" id="modal-overlay">
        <!-- formulário para adicionar ponto -->
    </div>

    <!-- Aba Análise de Grama -->
    <main class="app-layout tab-panel" id="tab-grass">
        <section class="grass-panel">
            <!-- upload, canvas, stats -->
        </section>
    </main>

    <!-- Aba Previsão IA -->
    <main class="app-layout tab-panel" id="tab-predict">
        <section class="predict-panel">
            <!-- formulário, resultados, gráfico -->
        </section>
    </main>

    <!-- Scripts -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script type="module" src="js/main.js"></script>
</body>
</html>
```

## 🎯 Benefícios da Organização

### CSS
✅ **Modularidade** — Cada dashboard tem seu próprio CSS  
✅ **Reutilização** — `base.css` compartilha estilos comuns  
✅ **Manutenibilidade** — Estilos organizados por feature  
✅ **Performance** — Apenas CSS necessário é carregado  
✅ **Escalabilidade** — Fácil adicionar novos dashboards  

### HTML
✅ **Simplicidade** — Uma única página HTML com múltiplas seções  
✅ **Clareza** — Cada seção é um dashboard bem definido  
✅ **Reutilização** — Modal é compartilhado entre dashboards  
✅ **Componentização** — Facilita futuras extrações em MFEs  

## 📊 Relação JS/CSS/HTML

```
main.js (orquestrador)
  ├─→ js/dashboards/monitor/
  │    ├─→ JS: monitor-map.js + monitor-dashboard.js
  │    └─→ CSS: css/dashboards/monitor/monitor.css
  │
  ├─→ js/dashboards/grass-analysis/
  │    ├─→ JS: grass-analysis.js
  │    └─→ CSS: css/dashboards/grass-analysis/grass-analysis.css
  │
  ├─→ js/dashboards/ai-prediction/
  │    ├─→ JS: ai-prediction.js
  │    └─→ CSS: css/dashboards/ai-prediction/ai-prediction.css
  │
  └─→ CSS compartilhado: css/shared/base.css
```

## 🔄 CSS Cascade

1. **base.css** — Define variáveis e estilos base para todos os dashboards
2. **dashboard-specific.css** — Sobrescreve ou complementa estilos específicos
3. **Leaflet CSS** — Estilos do Leaflet (carregado no `<head>`)

Isso permite que:
- Mudanças em variáveis CSS afetam todos os dashboards
- Cada dashboard pode ter estilos únicos sem conflitos
- O código é DRY (Don't Repeat Yourself)

## 📝 Arquivos Removidos

- ❌ `css/style.css` (consolidado em 4 arquivos específicos)

## 📋 Arquivos Criados

- ✅ `css/shared/base.css` (6.0 KB)
- ✅ `css/dashboards/monitor/monitor.css` (7.9 KB)
- ✅ `css/dashboards/grass-analysis/grass-analysis.css` (4.1 KB)
- ✅ `css/dashboards/ai-prediction/ai-prediction.css` (4.7 KB)

**Total**: ~22.7 KB (comparado com ~22.5 KB do arquivo original consolidado)
