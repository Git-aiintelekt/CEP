/**
 * The receipts as they were before Receipt Layouts: a layout saved before then (no Store Register settings) must print
 * exactly this, byte for byte. The files were written by the code of that time; never regenerate them to make a test pass.
 */
import { expect, test } from 'vitest'

import { renderReceiptEmailHtml, renderRegisterEmailHtml } from './receiptEmailHtml'
import { defaultSectionsFor } from './receiptPresets'
import { defaultRegisterSettings } from './registerSettings'
import { SAMPLE_TRANSACTIONS } from './sampleReceiptData'

const sale = SAMPLE_TRANSACTIONS.find((entry) => entry.data.register)!.data

test('Store Register without settings prints what it printed before', async () => {
  await expect(renderRegisterEmailHtml(sale)).toMatchFileSnapshot('./__golden__/register_sale.html')
  await expect(renderReceiptEmailHtml([], sale, 'REGISTER')).toMatchFileSnapshot('./__golden__/register_sale.html')
  await expect(renderRegisterEmailHtml(sale, defaultRegisterSettings())).toMatchFileSnapshot('./__golden__/register_sale.html')
})

test('the section presets print what they printed before', async () => {
  await expect(renderReceiptEmailHtml(defaultSectionsFor('STANDARD'), sale)).toMatchFileSnapshot('./__golden__/standard_sale.html')
})
