from PIL import Image, ImageDraw

# Generate simple solid-color shirt-like images with transparency

def make_shirt(color, path):
    W, H = 800, 900
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Body
    d.rectangle([150, 200, 650, 820], fill=color + (255,))
    # Sleeves
    d.polygon([(150, 220), (60, 430), (150, 430)], fill=color + (255,))
    d.polygon([(650, 220), (740, 430), (650, 430)], fill=color + (255,))
    img.save(path)

if __name__ == "__main__":
    make_shirt((200, 40, 40), "front.png")
    make_shirt((180, 30, 30), "back.png")
    print("Generated front.png and back.png")
