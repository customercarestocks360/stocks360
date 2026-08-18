import os
import re
import glob

# regex to find rounded-xl, rounded-2xl, rounded-3xl that are not already preceded by sm:
# (?<!sm:)rounded-(?:xl|2xl|3xl)

routes_dir = r"c:\me\project\Stocks360\frontend\webfrontend\src\routes"

for filepath in glob.glob(os.path.join(routes_dir, "*.tsx")):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # We want to replace rounded-xl with rounded sm:rounded-xl
    # But ONLY if it's not already sm:rounded-xl
    
    new_content = re.sub(r'(?<!sm:)rounded-(xl|2xl|3xl)', r'rounded sm:rounded-\1', content)
    
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")
