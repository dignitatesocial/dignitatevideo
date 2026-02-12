#!/usr/bin/env python3
"""
Fix the Dignitate n8n workflow to resolve the trend topic selection issue.

Problem: When user clicks "Carousel" button on a trend topic, the bot says
"I could not find that one-tap topic" because:
1. Inline buttons send bare '/carousel' without the topic
2. One-tap token commands fail when staticData tokens aren't found
3. No fallback to memory/sourceMessage when token lookup fails

Fixes:
1. Format Trend Message: Include topic in callback button data
2. Format Trend Message: Add one-tap token commands to message text
3. Quick Parse Slash: Add fallback when token lookup fails
"""

import json
import sys
import shutil
from datetime import datetime

WORKFLOW_FILE = '/Users/srikarreddy/Downloads/DemContent/dignitate-workflow-v3-stable.json'

def main():
    # Load workflow
    with open(WORKFLOW_FILE, 'r', encoding='utf-8') as f:
        workflow = json.load(f)

    fixes_applied = []

    # =========================================================================
    # FIX 1: Format Trend Message - Include topic in callback buttons + add
    #         one-tap token commands to trend message text
    # =========================================================================
    for node in workflow['nodes']:
        if node.get('name') == 'Format Trend Message':
            old_code = node['parameters']['jsCode']

            # Fix 1a: Change callback buttons to include the topic title
            # Old: callbackCarousel: '/carousel',\n      callbackVideo: '/video'
            # New: callbackCarousel: '/carousel ' + title.slice(0, 50), ...
            new_code = old_code.replace(
                "callbackCarousel: '/carousel',\n      callbackVideo: '/video'",
                "callbackCarousel: '/carousel ' + title.slice(0, 50),\n      callbackVideo: '/video ' + title.slice(0, 53)"
            )

            # Fix 1b: Update trend message to include one-tap token commands
            # Replace the old "Manual fallback" lines with token-based one-tap commands
            new_code = new_code.replace(
                "'Tap the buttons below to generate on this exact topic.',\n    'Manual fallback: /carousel',\n    'Manual fallback: /video'",
                "'One-tap exact commands (tap these):',\n"
                "    `/${d.topicToken ? 'carousel' + d.topicToken : 'carousel'}`,\n"
                "    `/${d.topicToken ? 'video' + d.topicToken : 'video'}`,\n"
                "    '',\n"
                "    'Tip: Use the buttons below for reliable one-tap.'"
            )

            if new_code != old_code:
                node['parameters']['jsCode'] = new_code
                fixes_applied.append('✓ Fixed Format Trend Message: callback buttons now include topic title')
            else:
                fixes_applied.append('⚠ Format Trend Message: no matching code found (may already be fixed)')
            break
    else:
        fixes_applied.append('✗ Format Trend Message node not found!')

    # =========================================================================
    # FIX 2: Quick Parse Slash - Add fallback when token lookup fails
    # =========================================================================
    for node in workflow['nodes']:
        if node.get('name') == 'Quick Parse Slash':
            old_code = node['parameters']['jsCode']

            # Replace the "give up" block with fallback logic
            old_block = (
                "if (exactTokenCommand && !args) {\n"
                "  actionType = 'none';\n"
                "  autoAction = '';\n"
                "}"
            )

            new_block = (
                "if (exactTokenCommand && !args) {\n"
                "  // Token lookup failed - try fallbacks before giving up\n"
                "  if (sourceMessageText) {\n"
                "    const sourceTopic = extractTopicFromTrendMessage(sourceMessageText, '/' + actionType);\n"
                "    if (sourceTopic) {\n"
                "      args = sourceTopic;\n"
                "      topicSource = 'source_message_fallback';\n"
                "    }\n"
                "  }\n"
                "  if (!args && fallbackTopic) {\n"
                "    args = fallbackTopic;\n"
                "    topicSource = 'memory_fallback';\n"
                "  }\n"
                "  if (!args) {\n"
                "    // Last resort: redirect to trends so user gets fresh topics\n"
                "    autoAction = actionType;\n"
                "    actionType = 'trends';\n"
                "    if (chatKey) staticData.pendingAutoActionByChat[chatKey] = autoAction;\n"
                "  }\n"
                "}"
            )

            new_code = old_code.replace(old_block, new_block)

            # Also update the error message for the 'none' case
            old_none_msg = (
                "none: exactTokenCommand && !args\n"
                "    ? 'I could not find that one-tap topic. Send /trends and tap a fresh one-tap command again.'\n"
                "    : 'Tell me what you want to create and the topic, and I will take it from there.'"
            )

            new_none_msg = (
                "none: 'Tell me what you want to create and the topic, and I will take it from there.'"
            )

            new_code = new_code.replace(old_none_msg, new_none_msg)

            if new_code != old_code:
                node['parameters']['jsCode'] = new_code
                fixes_applied.append('✓ Fixed Quick Parse Slash: token miss now falls back to memory/trends')
            else:
                fixes_applied.append('⚠ Quick Parse Slash: no matching code found (may already be fixed)')
            break
    else:
        fixes_applied.append('✗ Quick Parse Slash node not found!')

    # =========================================================================
    # FIX 3: Fix overlapping node positions
    # =========================================================================
    collect_pos = None
    package_pos = None
    for node in workflow['nodes']:
        if node.get('name') == 'Collect Images':
            collect_pos = node.get('position')
        if node.get('name') == 'Package Carousel Data':
            package_pos = node.get('position')
            if package_pos == collect_pos and collect_pos is not None:
                node['position'] = [collect_pos[0] + 240, collect_pos[1]]
                fixes_applied.append(f'✓ Fixed Package Carousel Data position: moved from {package_pos} to {node["position"]}')
            else:
                fixes_applied.append(f'  Package Carousel Data position OK ({package_pos} vs {collect_pos})')

    # =========================================================================
    # Save the fixed workflow
    # =========================================================================
    # Create backup
    backup_path = WORKFLOW_FILE.replace('.json', f'-backup-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
    shutil.copy2(WORKFLOW_FILE, backup_path)
    fixes_applied.append(f'✓ Created backup: {backup_path}')

    # Write fixed workflow
    with open(WORKFLOW_FILE, 'w', encoding='utf-8') as f:
        json.dump(workflow, f, indent=2, ensure_ascii=False)

    fixes_applied.append(f'✓ Saved fixed workflow to: {WORKFLOW_FILE}')

    # Print summary
    print('\n'.join(fixes_applied))
    print(f'\nTotal fixes: {len([f for f in fixes_applied if f.startswith("✓")])}')

if __name__ == '__main__':
    main()
