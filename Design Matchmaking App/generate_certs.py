#!/usr/bin/env python3
"""
Generate self-signed SSL certificates for development
Run: python3 generate_certs.py
"""

import ssl
import socket
from pathlib import Path

def generate_self_signed_cert():
    """Generate self-signed certificates using Python ssl module"""
    import subprocess
    import sys

    print("🔐 Sertifikat yaratilmoqda...")

    # mkcert ishlatib sertifikat yaratish
    try:
        # mkcert o'rnatilganligini tekshirish
        subprocess.run(['mkcert', '--version'], capture_output=True, check=True)
    except:
        print("❌ mkcert o'rnatilmagan. O'rnatish:")
        print("   Windows: choco install mkcert")
        print("   macOS: brew install mkcert")
        print("   Linux: brew install mkcert")
        return False

    # Sertifikat yaratish
    try:
        # Root CA init
        subprocess.run(['mkcert', '-install'], check=True)

        # Localhost sertifikatlarini yaratish
        subprocess.run([
            'mkcert',
            '-key-file', 'key.pem',
            '-cert-file', 'cert.pem',
            '192.168.13.118',
            'localhost',
            '127.0.0.1'
        ], check=True)

        print("✅ Sertifikatlar yaratildi:")
        print("   ✓ cert.pem")
        print("   ✓ key.pem")

        # Fayllar yaratilganligini tekshirish
        if Path('cert.pem').exists() and Path('key.pem').exists():
            print("\n✅ MUVAFFAQIYATLI! Backend HTTPS ga o'zgartirib qo'ying")
            return True
        else:
            print("❌ Sertifikat fayllar topilmadi")
            return False

    except subprocess.CalledProcessError as e:
        print(f"❌ Xato: {e}")
        return False

if __name__ == '__main__':
    success = generate_self_signed_cert()
    exit(0 if success else 1)

