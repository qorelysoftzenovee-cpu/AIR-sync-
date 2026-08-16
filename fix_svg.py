import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Sizes mapping based on Tailwind scales
sizes = {
    'w-3.5 h-3.5': '14px',
    'w-4 h-4': '16px',
    'w-5 h-5': '20px',
    'w-6 h-6': '24px',
    'w-8 h-8': '32px',
    'w-12 h-12': '48px',
}

def repl(m):
    svg_tag = m.group(0)
    for w_class, px in sizes.items():
        if w_class in svg_tag:
            return svg_tag.replace('<svg ', f'<svg style="width: {px}; height: {px};" ')
    return svg_tag

# Inject inline styles to SVGs
content = re.sub(r'<svg\s[^>]*>', repl, content)

# Remove Tailwind CDN script block
content = re.sub(r'\s*<!-- Tailwind CSS CDN with configuration -->.*?</script>\s*</script>', '', content, flags=re.DOTALL)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
