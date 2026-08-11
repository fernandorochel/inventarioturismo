# Configuracao do Google Drive para uploads

## Pasta exclusiva do inventario municipal

O banco de imagens e documentos do sistema deve usar uma pasta privada no Meu Drive:

- Nome: Sistema Inventario Turismo - Uploads
- Local: Meu Drive
- URL: https://drive.google.com/drive/folders/1HW4iPjbI9YNgm0tDunWHHGfcSoNPBMRh
- ID: `1HW4iPjbI9YNgm0tDunWHHGfcSoNPBMRh`

Em 2026-07-29, as permissoes foram verificadas e a pasta estava privada, somente com o proprietario `fernandorochelll@gmail.com`.

## Regra de compartilhamento

Esta pasta nao deve ser compartilhada com terceiros.

Se for necessario compartilhar no futuro, o limite definido para o projeto e compartilhar apenas com:

`turismoitatinga@gmail.com`

## Autenticacao recomendada

Para gravar arquivos diretamente em uma pasta privada do Meu Drive sem compartilhar com uma conta tecnica, o sistema deve usar OAuth da conta proprietaria do Drive.

Variaveis esperadas no VPS/Easypanel:

```env
GOOGLE_DRIVE_UPLOAD_FOLDER_ID=1HW4iPjbI9YNgm0tDunWHHGfcSoNPBMRh
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_DRIVE_UPLOAD_PUBLIC=false
GOOGLE_DRIVE_UPLOAD_PUBLIC_IMAGES=true
GOOGLE_DRIVE_USE_TYPE_FOLDERS=true
```

Com `GOOGLE_DRIVE_UPLOAD_PUBLIC=false`, PDFs e documentos permanecem privados no Drive. Com `GOOGLE_DRIVE_UPLOAD_PUBLIC_IMAGES=true`, as imagens dos cadastros ficam visíveis no Guia da Cidade.

Com `GOOGLE_DRIVE_USE_TYPE_FOLDERS=true`, o sistema organiza automaticamente:

- imagens em `01 - Imagens dos Cadastros`;
- PDFs em `02 - Documentos dos Cadastros`.

Observacao: arquivos privados do Drive nao aparecem publicamente para visitantes anonimos no Guia. Por isso, as imagens dos cadastros devem ficar liberadas por link, enquanto documentos internos, como ATAs do COMTUR, devem permanecer privados.
