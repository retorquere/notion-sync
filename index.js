const core = require('@actions/core')
const github = require('@actions/github')
const axios = require('axios')

const notionToken = core.getInput('notion_token')
const notionDatabaseId = core.getInput('notion_database_id')
const headers = {
  Authorization: `Bearer ${notionToken}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28',
}
let { action, repository } = github.context.payload
if (github.context.eventName === 'workflow_dispatch') action = 'load'

async function createOrUpdateNotionPage(issue, repository) {
  const data = {
    parent: { database_id: notionDatabaseId },
    properties: {
      Name: { title: [{ text: { content: issue.title } }] },
      Labels: { multi_select: issue.labels.map(label => ({ name: label.name })) },
      Project: { multi_select: [{ name: repository.name }] },
      URL: { url: issue.html_url },
      Issue: { number: issue.number },
      Status: { select: { name: action === 'opened' || action === 'load' ? 'Not started' : 'In development' } },
    },
  }

  await axios.post('https://api.notion.com/v1/pages', data, { headers })
}

async function getNotionPageId(issueUrl) {
  const response = await axios.post('https://api.notion.com/v1/databases/query', {
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: 'URL',
      url: { equals: issueUrl },
    },
  }, { headers })

  if (response.data.results.length > 0) {
    return response.data.results[0].id
  }
  return null
}

async function run() {
  try {
    let { issue } = github.context.payload
    switch (action) {
      case 'load': {
        const octokit = github.getOctokit(core.getInput('github_token'))
        const { data: issues } = await octokit.rest.issues.listForRepo({
          owner: repository.owner.login,
          repo: repository.name,
          state: 'open',
        })

        for (issue of issues) {
          const notionPageId = await getNotionPageId(issue.html_url)
          if (!notionPageId) await createOrUpdateNotionPage(issue)
        }
        break
      }

      case 'opened':
      case 'edited': {
        await createOrUpdateNotionPage(issue)
        break
      }

      case 'closed': {
        const notionPageId = await getNotionPageId(issue.html_url)
        if (notionPageId) await axios.delete(`https://api.notion.com/v1/pages/${notionPageId}`, { headers })
        break
      }
    }
  }
  catch (error) {
    core.setFailed(error.message)
  }
}

run()
