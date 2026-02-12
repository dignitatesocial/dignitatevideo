#!/usr/bin/env python3
"""Fix the n8n workflow to properly generate carousel images."""
import json

# Read the workflow
with open('/Users/srikarreddy/Downloads/DemContent/dignitate-n8n-workflow.json', 'r') as f:
    workflow = json.load(f)

# 1. Fix Parse Carousel Response - change 'text' to 'overlayText' in fallback
for node in workflow['nodes']:
    if node.get('name') == 'Parse Carousel Response':
        old_code = node['parameters']['jsCode']
        new_code = old_code.replace(
            "{ text: 'Content generation failed'",
            "{ overlayText: 'Content generation failed'"
        )
        node['parameters']['jsCode'] = new_code
        print("✓ Fixed Parse Carousel Response fallback")

# 2. Add "Split Slides" node
split_slides_node = {
    "parameters": {
        "jsCode": "// Split carousel into individual slides for image generation\nconst carouselData = $input.first().json;\nconst slides = carouselData.slides || [];\n\n// Return first slide for first image (can expand to loop later)\nconst firstSlide = slides[0] || { overlayText: 'Dementia Care Tips', imagePrompt: 'peaceful garden scene with elderly person' };\n\nreturn [{\n  json: {\n    overlayText: firstSlide.overlayText,\n    imagePrompt: firstSlide.imagePrompt,\n    slideIndex: 0,\n    totalSlides: slides.length,\n    title: carouselData.title,\n    slides: carouselData.slides,\n    hashtags: carouselData.hashtags,\n    caption: carouselData.caption,\n    chatId: carouselData.chatId,\n    args: carouselData.args\n  }\n}];"
    },
    "id": "split-slides",
    "name": "Split Slides",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1300, 200]
}

# Find index to insert after Parse Carousel Response
insert_idx = None
for i, node in enumerate(workflow['nodes']):
    if node.get('name') == 'Parse Carousel Response':
        insert_idx = i + 1
        break

if insert_idx:
    workflow['nodes'].insert(insert_idx, split_slides_node)
    print("✓ Added Split Slides node")

# 3. Update connections
connections = workflow.get('connections', {})

# Parse Carousel Response -> Split Slides (instead of Status Update)
connections['Parse Carousel Response'] = {
    "main": [[{"node": "Split Slides", "type": "main", "index": 0}]]
}

# Split Slides -> both Status Update AND fal.ai (parallel)
connections['Split Slides'] = {
    "main": [[
        {"node": "Carousel - Status Update", "type": "main", "index": 0},
        {"node": "fal.ai - Generate Image", "type": "main", "index": 0}
    ]]
}

# Remove old Carousel - Status Update connection (it shouldn't connect to fal.ai)
if 'Carousel - Status Update' in connections:
    del connections['Carousel - Status Update']

print("✓ Updated workflow connections")

# 4. Update Carousel - Status Update to use Split Slides data
for node in workflow['nodes']:
    if node.get('name') == 'Carousel - Status Update':
        # Update text to reference Split Slides data correctly
        node['parameters']['text'] = "=🎨 Creating Carousel...\n\n📝 {{ $json.title }}\n📊 {{ $json.totalSlides }} slides\n\n⏳ Generating image with fal.ai..."
        print("✓ Updated Carousel - Status Update text")

# 5. fal.ai node already expects $json.overlayText and $json.imagePrompt - which Split Slides provides
for node in workflow['nodes']:
    if node.get('name') == 'fal.ai - Generate Image':
        # Verify it uses overlayText and imagePrompt
        body = node['parameters'].get('jsonBody', '')
        if 'overlayText' in body and 'imagePrompt' in body:
            print("✓ fal.ai node already configured correctly")
        else:
            print("⚠ fal.ai node needs manual check")

# 6. Update Package Carousel Data to also include slides info from Split Slides
for node in workflow['nodes']:
    if node.get('name') == 'Package Carousel Data':
        node['parameters']['jsCode'] = """const imageResponse = $input.first().json;
const imageUrl = imageResponse.images?.[0]?.url || imageResponse.data?.images?.[0]?.url || '';
const slideData = $('Split Slides').first().json;
return [{ 
  json: { 
    title: slideData.title,
    slides: slideData.slides,
    hashtags: slideData.hashtags,
    caption: slideData.caption,
    chatId: slideData.chatId,
    args: slideData.args,
    imageUrl: imageUrl,
    firstImageUrl: imageUrl
  } 
}];"""
        print("✓ Updated Package Carousel Data")

# Save the updated workflow
with open('/Users/srikarreddy/Downloads/DemContent/dignitate-n8n-workflow.json', 'w') as f:
    json.dump(workflow, f, indent=4, ensure_ascii=False)

print("\n✅ Workflow updated successfully!")
print("Please re-import the workflow in n8n and test /carousel command")
