# Figma MCP config reference

Use this guide to configure the Figma MCP server in Verdent.

## Setup via Verdent Settings (Recommended)

1. Open Verdent Settings → MCP Servers
2. Click "Add Server" and enter:
   - Name: `figma`
   - URL: `https://mcp.figma.com/mcp`
3. Follow the OAuth authentication flow when prompted
4. The server will be automatically configured and enabled

## Manual Setup via mcp.json

Add the following to `~/.verdent/mcp.json`:

```json
{
  "mcpServers": {
    "figma": {
      "url": "https://mcp.figma.com/mcp",
      "enabled": true
    }
  }
}
```

## Notes

- OAuth authentication is handled automatically through the Verdent MCP settings panel
- Restart Verdent after making manual changes to `mcp.json`

## Setup + verification checklist

- Configure the Figma MCP server via Settings or mcp.json
- Restart Verdent if you made manual config changes
- Ask Verdent to list Figma tools or run a simple call to confirm the server is reachable

## Troubleshooting

- Server not connecting: Ensure the server is enabled in MCP settings
- OAuth errors: Try re-authenticating through Verdent Settings → MCP Servers
- Tools not available: Restart Verdent after configuration changes

## Usage reminders

- The server is link-based: copy the Figma frame or layer link, then ask Verdent to implement that URL
- If output feels generic, restate the project-specific rules from the main skill and ensure you follow the required flow (get_design_context → get_metadata if needed → get_screenshot)
