import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import {
  check,
  hasRedbox,
  renderViaHTTP,
  getRedboxSource,
} from 'next-test-utils'
import cheerio from 'cheerio'
import { join } from 'path'
import webdriver from 'next-webdriver'
import fs from 'fs-extra'

describe('jsconfig-path-reloading', () => {
  let next: NextInstance
  const tsConfigFile = 'jsconfig.json'
  const indexPage = 'pages/index.js'

  function runTests({ addAfterStart }: { addAfterStart?: boolean }) {
    beforeAll(async () => {
      let tsConfigContent = await fs.readFile(
        join(__dirname, 'app/jsconfig.json'),
        'utf8'
      )

      next = await createNext({
        files: {
          components: new FileRef(join(__dirname, 'app/components')),
          pages: new FileRef(join(__dirname, 'app/pages')),
          lib: new FileRef(join(__dirname, 'app/lib')),
          ...(addAfterStart
            ? {}
            : {
                [tsConfigFile]: tsConfigContent,
              }),
        },
        dependencies: {
          typescript: '4.7.4',
          '@types/react': 'latest',
          '@types/node': 'latest',
        },
      })

      if (addAfterStart) {
        await next.patchFile(tsConfigFile, tsConfigContent)
      }
    })
    afterAll(() => next.destroy())

    it('should load with initial paths config correctly', async () => {
      const html = await renderViaHTTP(next.url, '/')
      const $ = cheerio.load(html)
      expect(html).toContain('first button')
      expect(html).toContain('second button')
      expect($('#first-data').text()).toContain(
        JSON.stringify({
          hello: 'world',
        })
      )
    })

    it('should recover from module not found when paths is updated', async () => {
      const indexContent = await next.readFile(indexPage)
      const tsconfigContent = await next.readFile(tsConfigFile)
      const parsedTsConfig = JSON.parse(tsconfigContent)

      const browser = await webdriver(next.url, '/')

      try {
        const html = await browser.eval('document.documentElement.innerHTML')
        expect(html).toContain('first button')
        expect(html).toContain('second button')
        expect(html).toContain('first-data')
        expect(html).not.toContain('second-data')

        await next.patchFile(
          indexPage,
          `import {secondData} from "@lib/second-data"\n${indexContent.replace(
            '</p>',
            `</p><p id="second-data">{JSON.stringify(secondData)}</p>`
          )}`
        )

        expect(await hasRedbox(browser, true)).toBe(true)
        expect(await getRedboxSource(browser)).toContain('"@lib/second-data"')

        await next.patchFile(
          tsConfigFile,
          JSON.stringify(
            {
              ...parsedTsConfig,
              compilerOptions: {
                ...parsedTsConfig.compilerOptions,
                paths: {
                  ...parsedTsConfig.compilerOptions.paths,
                  '@lib/*': ['lib/first-lib/*', 'lib/second-lib/*'],
                },
              },
            },
            null,
            2
          )
        )

        expect(await hasRedbox(browser, false)).toBe(false)

        const html2 = await browser.eval('document.documentElement.innerHTML')
        expect(html2).toContain('first button')
        expect(html2).toContain('second button')
        expect(html2).toContain('first-data')
        expect(html2).toContain('second-data')
      } finally {
        await next.patchFile(indexPage, indexContent)
        await next.patchFile(tsConfigFile, tsconfigContent)
        await check(async () => {
          const html3 = await browser.eval('document.documentElement.innerHTML')
          return html3.includes('first-data') && !html3.includes('second-data')
            ? 'success'
            : html3
        }, 'success')
      }
    })

    it('should automatically fast refresh content when path is added without error', async () => {
      const indexContent = await next.readFile(indexPage)
      const tsconfigContent = await next.readFile(tsConfigFile)
      const parsedTsConfig = JSON.parse(tsconfigContent)

      const browser = await webdriver(next.url, '/')

      try {
        const html = await browser.eval('document.documentElement.innerHTML')
        expect(html).toContain('first button')
        expect(html).toContain('second button')
        expect(html).toContain('first-data')

        await next.patchFile(
          tsConfigFile,
          JSON.stringify(
            {
              ...parsedTsConfig,
              compilerOptions: {
                ...parsedTsConfig.compilerOptions,
                paths: {
                  ...parsedTsConfig.compilerOptions.paths,
                  '@myotherbutton': ['components/button-3.js'],
                },
              },
            },
            null,
            2
          )
        )
        await next.patchFile(
          indexPage,
          indexContent.replace('@mybutton', '@myotherbutton')
        )

        expect(await hasRedbox(browser, false)).toBe(false)

        await check(async () => {
          const html2 = await browser.eval('document.documentElement.innerHTML')
          expect(html2).toContain('first button')
          expect(html2).not.toContain('second button')
          expect(html2).toContain('third button')
          expect(html2).toContain('first-data')
          return 'success'
        }, 'success')
      } finally {
        await next.patchFile(indexPage, indexContent)
        await next.patchFile(tsConfigFile, tsconfigContent)
        await check(async () => {
          const html3 = await browser.eval('document.documentElement.innerHTML')
          return html3.includes('first button') &&
            !html3.includes('third button')
            ? 'success'
            : html3
        }, 'success')
      }
    })
  }

  describe('jsconfig', () => {
    runTests({})
  })

  describe('jsconfig added after starting dev', () => {
    runTests({ addAfterStart: true })
  })
})
