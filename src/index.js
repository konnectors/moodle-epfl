const { CookieKonnector, scrape, log, errors } = require('cozy-konnector-libs')

const TIMEOUT = Date.now() + 4 * 60 * 1000 // 4 minutes by default since the stack allows 5 minutes

class EpflConnector extends CookieKonnector {
  async testSession() {
    const $ = await this.request('https://moodle.epfl.ch/user/profile.php')
    return (
      $(`form[action='https://moodle.epfl.ch/login/index.php']`).length === 0
    )
  }

  async getFolder(folder, folderPath) {
    const $ = await this.request(folder.link)
    const content = scrape(
      $,
      {
        fileurl: {
          sel: 'a',
          attr: 'href'
        },
        filename: {
          sel: 'img',
          attr: 'title'
        }
      },
      '#folder_tree0 > ul > li > ul li > span'
    ).map(f => {
      const [vendorId, filePath] = f.fileurl
        .match(
          /^.*pluginfile.php\/(.*)\/mod_folder\/content\/0\/(.*)\?forcedownload=1/
        )
        .slice(1, 3)
      let subPath = null
      const tab = filePath.split('/')
      tab.pop()
      if (tab.length) subPath = tab.join('/')
      return { ...f, subPath, vendorId, filePath }
    })
    this.nameFilesInOrder(content)

    await this.saveFiles(
      content,
      { folderPath },
      {
        fileIdAttributes: ['vendorId', 'filePath']
      }
    )
  }

  nameFilesInOrder(files) {
    for (let i = 0; i < files.length; i++) {
      files[i].filename = `${String.fromCharCode(65 + i)} - ${
        files[i].filename
      }`
    }
  }

  async fetch(fields) {
    if (!(await this.testSession())) await this.login(fields)

    const courses = await this.fetchCourses()
    for (const course of courses) {
      const $ = await this.request.get(course.link)
      const regions = this.getRegions($)
      for (const region of regions) {
        if (Date.now() > TIMEOUT) {
          log('warn', 'Main timeout')
          continue
        }
        await this.getFinalLinksAndNames(region)
        const folders = region.content.filter(doc => doc.type === 'folder')
        if (folders.length) {
          for (const folder of folders) {
            await this.getFolder(folder, `${course.name}/${region.name}`)
          }
        }
        const files = region.content
          .filter(doc => doc.type === 'file')
          .map(doc => ({
            fileurl: doc.link,
            filename: `${doc.name}.${doc.ext}`,
            vendorId: doc.id
          }))

        this.nameFilesInOrder(files)
        const hasId = files.every(doc => doc.id)
        if (files.length) {
          await this.saveFiles(files, fields, {
            subPath: `${course.name}/${region.name}`,
            fileIdAttributes: hasId ? ['vendorId'] : null
          })
        }
      }
    }
  }

  /**
   * Get a redirect to have more information about the downloaded file : extension
   */
  async getFinalLinksAndNames(region) {
    for (const file of region.content) {
      const hasFileId = file.link.match(/id=(\d+)$/)
      if (hasFileId) file.id = hasFileId[1]
      else log('warn', 'could not find a file id in ' + file.link)
      const resp = await this.request.get(file.link, {
        followRedirect: false,
        followAllRedirects: false,
        simple: false,
        resolveWithFullResponse: true
      })
      let finalLink = resp.headers.location
      if (!finalLink) {
        const $ = resp.body
        const alternateLink = $('.resourceworkaround a')
        if (alternateLink.length) {
          finalLink = alternateLink.attr('href')
        }
      }
      if (finalLink) {
        const splitted = finalLink.split('.')
        if (splitted) {
          file.ext = splitted.pop()
          file.link = finalLink
        }
      }
    }
  }

  async login(fields) {
    await this.request.get('https://moodle.epfl.ch/')
    let $ = await this.request.get('https://moodle.epfl.ch/login/index.php')
    const requestkey = $('#requestkey').val()
    $ = await this.request.post(
      'https://tequila.epfl.ch/cgi-bin/tequila/login',
      {
        form: {
          requestkey,
          username: fields.login,
          password: fields.password
        }
      }
    )

    if ($.html().includes('Authentification invalide')) {
      throw new Error(errors.LOGIN_FAILED)
    }
  }

  getRegions($) {
    return scrape(
      $,
      {
        name: 'h3.sectionname',
        content: {
          sel: 'ul.section',
          fn: $el => {
            const result = Array.from($el.find('li.activity a'))
              .map(el => ({
                type: this.getLinkType($(el)),
                link: $(el).attr('href'),
                name: $(el).text()
              }))
              .filter(doc => ['file', 'folder'].includes(doc.type))

            return result
          }
        }
      },
      '[role=region]'
    ).filter(doc => doc.name.length > 0)
  }

  getLinkType($a) {
    const $li = $a.closest('li.activity')
    let linkType = 'unknown'
    if ($li.hasClass('modtype_folder')) {
      linkType = 'folder'
    } else if ($li.hasClass('modtype_resource')) {
      linkType = 'file'
    }
    return linkType
  }

  async fetchCourses() {
    const $ = await this.request.get('https://moodle.epfl.ch/my/')

    return scrape(
      $,
      {
        name: '.media-body',
        link: {
          sel: 'div',
          fn: $ => $.closest(`[data-parent-key=mycourses]`).attr('href') // this is a trick for the element to get itself in scrape
        }
      },
      `[data-parent-key=mycourses]`
    )
  }
}

const connector = new EpflConnector({
  // debug: true,
  cheerio: true,
  json: false,
  jar: true
})

connector.run()
