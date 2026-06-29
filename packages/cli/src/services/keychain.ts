import keytar from 'keytar'

const SERVICE = 'mcpinv'

function accountKey(serverId: string, secretKey: string): string {
  return `${serverId}:${secretKey}`
}

export async function setSecret(serverId: string, key: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, accountKey(serverId, key), value)
}

export async function getSecret(serverId: string, key: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, accountKey(serverId, key))
}

export async function deleteSecret(serverId: string, key: string): Promise<void> {
  await keytar.deletePassword(SERVICE, accountKey(serverId, key))
}

export async function listSecrets(serverId: string): Promise<string[]> {
  const creds = await keytar.findCredentials(SERVICE)
  return creds
    .filter(c => c.account.startsWith(`${serverId}:`))
    .map(c => c.account.split(':')[1])
}
