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
```

Com `GOOGLE_DRIVE_UPLOAD_PUBLIC=false`, os arquivos permanecem privados no Drive. O sistema salva o link interno do arquivo no cadastro.

Observacao: arquivos privados do Drive nao aparecem publicamente para visitantes anonimos no Guia. Para imagens aparecerem no Guia publico, seria necessario publicar imagens especificas ou usar outro armazenamento publico controlado.
