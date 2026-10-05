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
```

Se `py` não for reconhecido, tente `python -m venv .venv`. Se o Python foi instalado, mas ainda não está no `PATH`, use o caminho do executável instalado. Por exemplo, na instalação por usuário do Python 3.12:

```powershell
& "$env:LocalAppData\Programs\Python\Python312\python.exe" -m venv .venv
```

Instale as dependências usando o Python do ambiente virtual. Assim, não é necessário ativá-lo nem alterar a política de execução do PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r src\ml\requirements.txt
```

Os comandos seguintes também usam diretamente o Python do ambiente virtual, então não precisam de `Activate.ps1`.

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

No primeiro terminal, inicie a API Python. O endereço `127.0.0.1` limita o acesso ao próprio computador:

```powershell
# Windows PowerShell
.\.venv\Scripts\python.exe -m uvicorn src.ml.api_server:app --reload --host 127.0.0.1 --port 8000
```

```bash
# macOS ou Linux
./.venv/bin/python -m uvicorn src.ml.api_server:app --reload --host 127.0.0.1 --port 8000
```

A documentação interativa da API fica em <http://127.0.0.1:8000/docs>.

No segundo terminal, também na raiz do projeto, inicie o servidor dos arquivos do frontend:

```powershell
.\.venv\Scripts\python.exe -m http.server 5500 --bind 127.0.0.1 --directory src
```

```bash
# macOS ou Linux
./.venv/bin/python -m http.server 5500 --bind 127.0.0.1 --directory src
```

Abra <http://127.0.0.1:5500> no navegador. O dashboard de previsão usa a API quando ela está disponível e recorre a uma simulação local quando a API não responde. Esses comandos são para uso local; para receber fotos de outro dispositivo, consulte a seção abaixo e configure o acesso de rede conscientemente.

## Receber fotos do app mobile

O app envia cada foto por `POST /api/capturas` (multipart: `corridaId`, `lat`, `lng`, `timestamp`, `foto`). O servidor salva o JPEG em `src/ml/capturas/<corridaId>/`, mede a altura da grama e grava tudo em `local_predictions.db`.

Variáveis de ambiente opcionais:

- `MOTIVA_API_KEY`: se definida, o `POST /api/capturas` exige o header `X-API-Key` com esse valor. No app, use `api.token` no `local.properties`.
- `MOTIVA_CORS_ORIGINS`: origens extras permitidas, separadas por vírgula. `localhost` e redes privadas (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) já são aceitas.

Endpoints de leitura:

- `GET /api/corridas`: resumo por corrida.
- `GET /api/trechos?corridaId=&de=&ate=&celula=0.0005&limite=500`: fotos agrupadas por trecho (células de cerca de 55 m), com a maior altura e a foto correspondente. `de` e `ate` são timestamps em ms.
- `GET /api/capturas?corridaId=&de=&ate=&limite=100&offset=0`: lista paginada.
- `GET /capturas/<corridaId>/<timestamp>.jpg`: a imagem.

O dashboard consulta `/api/trechos` a cada 15 s. Se a API estiver em outro endereço, abra o dashboard com `?api=http://IP:8000`.

## Treinar o modelo

Com as dependências instaladas, execute na raiz do projeto:

```powershell
# Windows PowerShell
.\.venv\Scripts\python.exe src\ml\train_cut_model.py --data src\ml\data\cut_training_sample.csv --out src\ml\model_bundle.joblib
```

```bash
# macOS ou Linux
./.venv/bin/python src/ml/train_cut_model.py --data src/ml/data/cut_training_sample.csv --out src/ml/model_bundle.joblib
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