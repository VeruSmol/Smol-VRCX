---

# VRCX, but with bonus!
## The aforementioned bonus:
- **Easier debugging of VRCDN streams**
- **Dedicated Group Info Page**
- **Dedicated Group Instances Page**
- **Auto-open newly created Group Instances**
- Built with the [VRChat API Guidelines](https://github.com/VRChatAPI/vrchatapi.github.io) in mind <3

### Hello all! This is my smol fork of VRCX. I'm still learning a lot about development, so please give feedback on any jank. I use these features nearly every day, I hope they are useful for you! 



## Automatically parse VRCDN Preview links from player links
- Clicking **Open** on a video play link in the Game Log will open the preview in your default browser.
- Helpful for quickly checking the link in the world is live!
- Supports RTMP, RTSPT, and HTTPS VRCDN player links. *(all VRCDN links as of March '26 should open correctly)*
- When world audio sounds strange, checking the preview can help isolate the issue. 

## Dedicated Group Info Page
The Info page can get kind of noisy, so this version has separate pages for info and instances! 

<img width="770" height="707" alt="image" src="https://github.com/user-attachments/assets/99db77ea-e010-4e8d-ad17-6433d04d0569" />


## Dedicated Group Intances page Page
The instances list has been moved to it's own page, with a couple features added! 



## Auto-open newly created Group Instances
<img width="880" height="125" alt="image" src="https://github.com/user-attachments/assets/15352ff2-529b-478d-a112-66737c112a9d" />

<img width="840" height="25" alt="image" src="https://github.com/user-attachments/assets/1908aaf3-ab7c-483a-b228-59843bdeaadb" />




- Checks if you are a member of the group and updates the tooltips accordingly.
- Polite default settings.
- Continue using VRCX, spending time with your friends, and once the group of your choice has an instance open, join it! 
- Safeguards and warnings built in for potentially problematic settings to prevent API abuse.
- Automatically stops if issued a VRChat API rate-limit.
- New Instances open in the Instance page of the VRChat big menu.
- Uses existing external URL API that other services and features use *(open in VRChat, vrc.tl, etc).*

When viewing a Group's page, you can select the option to automatically open the instance in VRChat (via external URL). 

# How to install:
**Requires: Windows 10+** *(macos & linux electron versions maybe at some point)*

**New Users:** 
- Download the zip in the latest release.
- Extract the zip file to a folder.
- Run the VRCX.exe located inside the `Cef` folder.
- Enjoy! 

**Existing users:** 
- Disable both of these settings in your current VRCX. 
<img width="438" height="89" alt="image" src="https://github.com/user-attachments/assets/87669794-b2ba-4f8c-979b-e300b46d0d99" />

- Download the zip in the latest release.
- Extract the zip file to a folder.
- Run the VRCX.exe located inside the `Cef` folder.
- Re-enable the above settings in the updated version.
- Enjoy!

