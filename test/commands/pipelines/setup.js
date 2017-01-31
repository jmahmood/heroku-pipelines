const cli = require('heroku-cli-util')
const nock = require('nock')
const sinon = require('sinon')
const inquirer = require('inquirer')
const expect = require('chai').expect
const cmd = require('../../../commands/pipelines/setup')

describe('pipelines:setup', function () {
  beforeEach(function () {
    cli.mockConsole()
    sinon.stub(cli, 'open').returns(Promise.resolve())
  })

  afterEach(function () {
    nock.cleanAll()
    cli.open.restore()
  })

  it('errors if the user is not linked to GitHub', function * () {
    try {
      yield cmd.run({ args: {}, flags: {} })
    } catch (error) {
      expect(error.message).to.equal('Account not connected to GitHub.')
    }
  })

  context('with an account connected to GitHub', function () {
    let pipeline, repo, archiveURL, prodApp, stagingApp, kolkrabbiAccount
    let api, kolkrabbi, github

    beforeEach(function () {
      archiveURL = 'https://example.com/archive.tar.gz'
      kolkrabbiAccount = { github: { token: '123-abc' } }

      pipeline = {
        id: '123-pipeline',
        name: 'my-pipeline'
      }

      repo = {
        id: 123,
        default_branch: 'master',
        name: 'my-org/my-repo'
      }

      prodApp = {
        id: '123-prod-app',
        name: pipeline.name
      }

      stagingApp = {
        id: '123-staging-app',
        name: `${pipeline.name}-staging`
      }

      kolkrabbi = nock('https://kolkrabbi.heroku.com')
      kolkrabbi.get('/account/github/token').reply(200, kolkrabbiAccount)
      kolkrabbi.post(`/pipelines/${pipeline.id}/repository`).reply(201, {})
      kolkrabbi.patch(`/apps/${stagingApp.id}/github`).reply(200, {})

      github = nock('https://api.github.com')
      github.get(`/repos/${repo.name}`).reply(200, repo)

      github.get(`/repos/${repo.name}/tarball/${repo.default_branch}`).reply(301, '', {
        location: archiveURL
      })

      api = nock('https://api.heroku.com')
      api.post('/pipelines').reply(201, pipeline)

      api.post('/pipeline-couplings', {
        pipeline: pipeline.id,
        app: prodApp.id,
        stage: 'production'
      }).reply(201, {})

      api.post('/pipeline-couplings', {
        pipeline: pipeline.id,
        app: stagingApp.id,
        stage: 'staging'
      }).reply(201, {})

      sinon.stub(inquirer, 'prompt').resolves({
        name: pipeline.name,
        repo: repo.name,
        ci: true
      })
    })

    afterEach(function () {
      inquirer.prompt.restore()
    })

    context('in a personal account', function () {
      beforeEach(function () {
        api.post('/app-setups', {
          source_blob: { url: archiveURL },
          app: { name: prodApp.name, personal: true }
        }).reply(201, { app: prodApp })

        api.post('/app-setups', {
          source_blob: { url: archiveURL },
          app: { name: stagingApp.name, personal: true }
        }).reply(201, { app: stagingApp })
      })

      it('creates apps in the personal account', function* () {
        yield cmd.run({ args: {}, flags: {} })

        api.done()
        github.done()
        kolkrabbi.done()
      })

      it('enables ci if the user is flagged in', function* () {
        api.get('/account/features/ci').reply(200, { enabled: true })
        kolkrabbi.patch(`/pipelines/${pipeline.id}/repository`, {
          ci: true
        }).reply(200)

        yield cmd.run({ args: {}, flags: {} })

        api.done()
        github.done()
        kolkrabbi.done()
      })

      it('downcases capitalised pipeline names', function* () {
        yield cmd.run({ args: { name: pipeline.name.toUpperCase() }, flags: {} })

        api.done()
        github.done()
        kolkrabbi.done()
      })
    })

    context('in an organization', function () {
      let organization

      beforeEach(function () {
        organization = 'test-org'

        api.post('/app-setups', {
          source_blob: { url: archiveURL },
          app: { name: prodApp.name, organization }
        }).reply(201, { app: prodApp })

        api.post('/app-setups', {
          source_blob: { url: archiveURL },
          app: { name: stagingApp.name, organization }
        }).reply(201, { app: stagingApp })
      })

      it('creates apps in an organization', function* () {
        yield cmd.run({ args: {}, flags: { organization } })

        api.done()
        github.done()
        kolkrabbi.done()
      })

      it('enables ci billed to the org if the user is flagged in', function* () {
        api.get('/account/features/ci').reply(200, { enabled: true })
        kolkrabbi.patch(`/pipelines/${pipeline.id}/repository`, {
          ci: true,
          organization
        }).reply(200)

        yield cmd.run({ args: {}, flags: { organization } })

        api.done()
        github.done()
        kolkrabbi.done()
      })
    })
  })
})
