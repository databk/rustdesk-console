import io, os

base = '/workspace/.scratch/webc/src/locales'

texts = {
    'zh-CN': {
        'protocolRendezvous': '服务器返回了无法识别的握手回复（未得到中继或打洞结果）。',
        'protocolHash': '被控端返回的密码挑战数据异常，无法继续认证。',
        'protocolLogin': '被控端登录响应缺少桌面信息（既无错误也无设备信息）。',
        'protocolPeerInfo': '被控端返回的桌面/显示信息校验失败，可能是分辨率或显示数量超出支持范围。',
    },
    'en-US': {
        'protocolRendezvous': 'The server returned an unrecognized handshake reply (no relay or punch-hole result).',
        'protocolHash': 'The remote device sent an invalid password challenge.',
        'protocolLogin': 'The remote login response contained neither an error nor device information.',
        'protocolPeerInfo': 'Remote desktop/display information failed validation. The resolution or display count may be out of range.',
    },
    'es-ES': {
        'protocolRendezvous': 'El servidor devolvió una respuesta de negociación no reconocida (sin resultado de retransmisión ni de conexión directa).',
        'protocolHash': 'El dispositivo remoto envió un desafío de contraseña no válido.',
        'protocolLogin': 'La respuesta de inicio de sesión remota no contenía ni error ni información del dispositivo.',
        'protocolPeerInfo': 'La información de pantalla del escritorio remoto no superó la validación. Puede que la resolución o el número de pantallas esté fuera de rango.',
    },
    'fr-FR': {
        'protocolRendezvous': "Le serveur a renvoyé une réponse de négociation non reconnue (aucun résultat de relais ni de connexion directe).",
        'protocolHash': 'Le dispositif distant a envoyé un défi de mot de passe invalide.',
        'protocolLogin': "La réponse de connexion distante ne contenait ni erreur ni informations sur l'appareil.",
        'protocolPeerInfo': "Les informations d'écran du bureau distant ont échoué à la validation. La résolution ou le nombre d'écrans est peut-être hors limites.",
    },
    'pt-BR': {
        'protocolRendezvous': 'O servidor retornou uma resposta de negociação não reconhecida (sem resultado de retransmissão ou conexão direta).',
        'protocolHash': 'O dispositivo remoto enviou um desafio de senha inválido.',
        'protocolLogin': 'A resposta de login remota não continha erro nem informações do dispositivo.',
        'protocolPeerInfo': 'As informações de tela da área de trabalho remota falharam na validação. A resolução ou a quantidade de telas pode estar fora do limite.',
    },
    'ru-RU': {
        'protocolRendezvous': 'Сервер вернул нераспознанный ответ рукопожатия (нет результата ретрансляции или прямого подключения).',
        'protocolHash': 'Удалённое устройство отправило некорректный запрос пароля.',
        'protocolLogin': 'Ответ удалённого входа не содержит ни ошибки, ни сведений об устройстве.',
        'protocolPeerInfo': 'Сведения об экранах удалённого рабочего стола не прошли проверку. Возможно, разрешение или число экранов вне допустимого диапазона.',
    },
}

for loc, mapping in texts.items():
    path = os.path.join(base, loc, 'webClient', 'sessionSettings.ts')
    with io.open(path, encoding='utf-8') as f:
        src = f.read()
    if "'webClient.error.protocolRendezvous'" in src:
        continue
    lines = ["  'webClient.error.protocol%s': '%s',\n" % (k[0].upper() + k[1:], v.replace("'", "\\'")) for k, v in mapping.items()]
    idx = src.rstrip().rfind('\n};')
    assert idx != -1, path
    src = src[:idx] + '\n' + ''.join(lines) + src[idx:]
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(src)
    print('updated', path)
