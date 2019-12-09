const { requestFactory, BaseKonnector } = require('cozy-konnector-libs')

const request = requestFactory({
  debug: 'json',
  cheerio: true,
  json: false,
  jar: true
})

module.exports = new BaseKonnector(start)

async function start(fields) {
  await request.get('https://moodle.epfl.ch/')
  let $ = await request.get('https://moodle.epfl.ch/login/index.php')
  const requestkey = $('#requestkey').val()
  await request.post('https://tequila.epfl.ch/cgi-bin/tequila/login', {
    form: {
      requestkey,
      username: fields.login,
      password: fields.password
    }
  })
}
