"""What a run sends. A drip message's run (campaign_run.drip_step_id, patch 0042) sends its step's own template, subject,
preheader and A/B test; every other run sends the campaign's template, as it always has."""
from apps.templates.models import RenderedTemplateContent


def of_run(run) -> tuple:
    """-> (template, content, step): the template, its latest saved content (None when there is none) and the drip step or None."""
    step = run.drip_step if run.drip_step_id else None
    if step is not None:
        template = step.template if step.template_id and step.template.deleted_at is None else None
    else:
        template = run.campaign.template if run.campaign.template_id else None
    content = RenderedTemplateContent.objects.filter(template_id=template.pk).order_by("-version_number").first() if template else None
    return template, content, step


def step_label(step) -> str:
    """"Message 2 (How Points Work)", as the activity log and the failure name a message."""
    position = type(step).objects.filter(campaign_id=step.campaign_id, day__lt=step.day).count() + 1
    return f"Message {position}" + (f" ({step.name})" if step.name else "")
