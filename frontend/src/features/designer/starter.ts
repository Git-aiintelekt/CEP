/** What a brand-new email template opens with: a sendable skeleton, including the unsubscribe link marketing mail needs. */
export const STARTER_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#334155" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f6f7fb">
    <mj-section background-color="#ffffff" padding="24px 24px 8px">
      <mj-column>
        <mj-text font-size="20px" font-weight="700" color="#0f172a" letter-spacing="0.5px">YOUR BRAND</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="8px 24px 24px">
      <mj-column>
        <mj-text font-size="24px" line-height="32px" color="#0f172a" font-weight="700">Hi {{first_name}},</mj-text>
        <mj-text>Write your message here. Select this text to edit it, and use the tag menu in the text toolbar to personalize it.</mj-text>
        <mj-button href="{{shop_url}}" background-color="#2753e4" border-radius="8px" font-weight="700" align="left">Shop now</mj-button>
      </mj-column>
    </mj-section>
    <mj-section css-class="cep-footer" padding="16px 24px">
      <mj-column>
        <mj-text font-size="12px" line-height="18px" color="#64748b" align="center">
          You are receiving this email because you subscribed to our updates.<br />
          <a href="{{unsubscribe_url}}" style="color:#64748b">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`
