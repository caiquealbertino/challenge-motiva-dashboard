# Motiva | Monitoramento de Vegetação

Dashboard para monitorar áreas verdes, analisar imagens de gramado e estimar a necessidade de corte.

## Requisitos

- Python 3.12
- Windows PowerShell, macOS ou Linux
- Acesso à internet para carregar o mapa, fontes e dados meteorológicos externos

## Executar no Windows

No PowerShell, na pasta raiz do projeto, crie o ambiente e instale as dependências:

```powershell
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r src\ml\requirements.txt
```

O comando de política vale somente para a sessão atual do PowerShell. Se o Python Launcher não estiver disponível, instale o Python 3.12 e use `python` no lugar de `py -3.12` ao criar o ambiente.

## Executar no macOS ou Linux

Na raiz do projeto:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r src/ml/requirements.txt
```

## Iniciar a aplicação

Use dois terminais, ambos na raiz do projeto.

No primeiro terminal, inicie a API Python:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
python -m uvicorn src.ml.api_server:app --reload --port 8000
```

```bash
# macOS ou Linux
source .venv/bin/activate
python -m uvicorn src.ml.api_server:app --reload --port 8000
```

A documentação interativa da API fica em <http://127.0.0.1:8000/docs>.

No segundo terminal, inicie um servidor para os arquivos do frontend:

```powershell
py -m http.server 5500 --directory src
```

No macOS ou Linux, use `python3 -m http.server 5500 --directory src`. Abra <http://127.0.0.1:5500> no navegador. O dashboard de previsão usa a API quando ela está disponível e recorre a uma simulação local quando a API não responde.

## Treinar o modelo

Com o ambiente ativado e as dependências instaladas, execute na raiz:

```bash
python src/ml/train_cut_model.py --data src/ml/data/cut_training_sample.csv --out src/ml/model_bundle.joblib
```

O conjunto de dados precisa conter as colunas exigidas pelo script e ao menos 30 linhas válidas. O treinamento substitui o arquivo do modelo usado pela API.

## Estrutura

- `src/index.html`, `src/css/` e `src/js/`: aplicação web e dashboards.
- `src/ml/api_server.py`: API de previsão em FastAPI.
- `src/ml/model_bundle.joblib`: modelo treinado carregado pela API.
- `src/ml/train_cut_model.py`: treinamento do modelo.
- `src/ml/requirements.txt`: dependências Python.
- `docs/`: documentação de arquitetura e desenvolvimento.

O ambiente virtual `.venv`, caches Python e o banco local de previsões não devem ser versionados. Eles são ignorados pelo Git; as dependências podem ser reinstaladas usando o arquivo `requirements.txt`.