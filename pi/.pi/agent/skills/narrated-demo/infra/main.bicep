// Azure AI Speech for narrated demos: one Speech resource, Entra ID sign-in only (no keys),
// and the "Cognitive Services Speech User" role for whoever records the demos.
targetScope = 'resourceGroup'

@description('Speech resource name. Also its custom subdomain, which Entra ID sign-in requires.')
@minLength(2)
@maxLength(64)
param name string = 'narrated-demo-${uniqueString(resourceGroup().id)}'

@description('Azure region. swedencentral offers every voice tier: HD, MAI and Azure OpenAI voices.')
param location string = resourceGroup().location

@description('S0 is pay as you go and includes HD voices. F0 is free (one per subscription) and may not.')
@allowed(['F0', 'S0'])
param sku string = 'S0'

@description('Object ID of the user, group or service principal that synthesises speech.')
param principalId string

@allowed(['User', 'Group', 'ServicePrincipal'])
param principalType string = 'User'

param tags object = {
  purpose: 'demo-narration'
}

resource speech 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  kind: 'SpeechServices'
  sku: {
    name: sku
  }
  tags: tags
  properties: {
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

// Built-in role: Cognitive Services Speech User.
var speechUser = 'f2dc8367-1007-4938-bd23-fe263f013447'

resource access 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speech.id, principalId, speechUser)
  scope: speech
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', speechUser)
    principalId: principalId
    principalType: principalType
  }
}

output name string = speech.name
output resourceId string = speech.id
output endpoint string = speech.properties.endpoint
output location string = speech.location
