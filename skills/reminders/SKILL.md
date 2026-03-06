# Reminders Skill

Manage reminders and to-dos. Uses the `add_reminder`, `list_reminders`, and `complete_reminder` tools.

## Capabilities

- Add reminders with optional due date/time
- List pending reminders
- Mark reminders as complete

## Usage

When the user asks to:
- **Set a reminder:** Use `add_reminder` with message and optional `dueAt` (ISO 8601 or natural: "in 1 hour", "tomorrow 9am")
- **Show reminders:** Use `list_reminders`
- **Complete one:** Use `complete_reminder` with the reminder ID

## Example prompts

- "Remind me to call Mom in 2 hours"
- "What reminders do I have?"
- "Mark reminder 3 as done"
