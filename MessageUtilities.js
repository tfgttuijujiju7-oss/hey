/**
 * Message Injector - Kettu Framework
 * Complete message injection plugin with full UI and functionality
 * 
 * @version 2.0.0
 * @author YourName
 */

const Plugin = class MessageInjector {
    constructor(meta) {
        this.meta = meta;
        this.id = meta.id;
        this.name = meta.name;
        this.version = meta.version;
        this.author = meta.author;
        
        // Global state
        this.injectorModal = null;
        this.isModalOpen = false;
        this.userInfoCache = new Map();
        this.initialized = false;
        
        // Default configuration
        this.config = {
            features: {
                autoOpenUI: true,
                showNotifications: true,
                enableCache: true
            },
            defaults: {
                targetUserId: "",
                senderUserId: "", 
                messageContent: "",
                embedTitle: "",
                embedDescription: "",
                embedImageUrl: ""
            },
            ui: {
                position: "floating", // floating, toolbar, header
                theme: "discord" // discord, dark, light
            }
        };
    }

    // =============================================
    // KETTU PLUGIN LIFECYCLE
    // =============================================

    load() {
        try {
            kettu.Logger.info(`Loading ${this.name} v${this.version}...`);
            
            // Initialize with delay to ensure Discord is loaded
            setTimeout(() => {
                this.initializePlugin();
            }, 2000);
            
            // Add global access
            window.MessageInjectorAPI = this.api;
            
            kettu.Logger.success(`${this.name} loaded successfully!`);
            return true;
        } catch (error) {
            kettu.Logger.error(`Failed to load ${this.name}:`, error);
            return false;
        }
    }

    unload() {
        try {
            kettu.Logger.info(`Unloading ${this.name}...`);
            
            this.cleanupUI();
            this.cleanupEventListeners();
            
            // Remove global access
            delete window.MessageInjectorAPI;
            
            kettu.Logger.success(`${this.name} unloaded successfully!`);
            return true;
        } catch (error) {
            kettu.Logger.error(`Failed to unload ${this.name}:`, error);
            return false;
        }
    }

    onEnable() {
        kettu.Logger.info(`${this.name} enabled`);
        this.showNotification(`${this.name} enabled!`, 'success');
    }

    onDisable() {
        kettu.Logger.info(`${this.name} disabled`);
        this.showNotification(`${this.name} disabled!`, 'info');
    }

    // =============================================
    // PLUGIN INITIALIZATION
    // =============================================

    initializePlugin() {
        if (this.initialized) return;
        
        try {
            // Load saved configuration
            this.loadConfig();
            
            // Initialize core components
            this.initializeModules();
            this.initializeUI();
            this.initializeEventListeners();
            
            this.initialized = true;
            kettu.Logger.debug('Plugin initialized successfully');
            
        } catch (error) {
            kettu.Logger.error('Failed to initialize plugin:', error);
        }
    }

    loadConfig() {
        try {
            const saved = kettu.PluginStorage.get(this.id, 'config');
            if (saved) {
                this.config = { ...this.config, ...saved };
                kettu.Logger.debug('Configuration loaded');
            }
        } catch (error) {
            kettu.Logger.warn('Could not load configuration, using defaults');
        }
    }

    saveConfig() {
        try {
            kettu.PluginStorage.set(this.id, 'config', this.config);
            kettu.Logger.debug('Configuration saved');
        } catch (error) {
            kettu.Logger.warn('Could not save configuration');
        }
    }

    initializeModules() {
        // Pre-load essential modules
        this.modules = {
            MessageActions: null,
            UserStore: null,
            ChannelStore: null,
            FluxDispatcher: null,
            HTTP: null
        };
        
        // Load modules in background
        this.loadEssentialModules();
    }

    async loadEssentialModules() {
        try {
            this.modules.MessageActions = await this.waitForModule(['sendMessage', 'receiveMessage']);
            this.modules.UserStore = await this.waitForModule(['getUser', 'getCurrentUser']);
            this.modules.ChannelStore = await this.waitForModule(['getChannel', 'getDMFromUserId']);
            this.modules.FluxDispatcher = kettu.Modules.common?.FluxDispatcher;
            this.modules.HTTP = await this.waitForModule(['get', 'post', 'put', 'del']);
            
            kettu.Logger.debug('Essential modules loaded');
        } catch (error) {
            kettu.Logger.warn('Some modules failed to load:', error);
        }
    }

    initializeUI() {
        this.createInjectorUI();
        this.addInjectorButton();
        
        if (this.config.features.autoOpenUI) {
            setTimeout(() => {
                this.showNotification(`Click the "💬 Inject" button to start!`, 'info');
            }, 3000);
        }
    }

    initializeEventListeners() {
        // Add global keyboard shortcut (Ctrl+Shift+I)
        this.keyboardHandler = (event) => {
            if (event.ctrlKey && event.shiftKey && event.key === 'I') {
                event.preventDefault();
                this.toggleInjector();
            }
        };
        
        document.addEventListener('keydown', this.keyboardHandler);
    }

    cleanupEventListeners() {
        if (this.keyboardHandler) {
            document.removeEventListener('keydown', this.keyboardHandler);
        }
    }

    // =============================================
    // CORE MESSAGE FUNCTIONALITY
    // =============================================

    async waitForModule(props, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const module = kettu.Modules.getByProps(...props);
            if (module) return module;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Module with props ${props.join(', ')} not found`);
    }

    async ensureDmChannel(userId) {
        try {
            if (!this.modules.ChannelStore) {
                this.modules.ChannelStore = await this.waitForModule(['getDMFromUserId']);
            }
            
            if (!this.modules.HTTP) {
                this.modules.HTTP = await this.waitForModule(['post']);
            }
            
            // Check existing DM channel
            const existing = this.modules.ChannelStore.getDMFromUserId?.(userId);
            if (existing) return existing.id || existing;
            
            // Create new DM channel
            const response = await this.modules.HTTP.post({
                url: "/users/@me/channels",
                body: { recipient_id: userId }
            });
            
            if (response?.body?.id) {
                return response.body.id;
            }
            
            throw new Error('Failed to create DM channel');
            
        } catch (error) {
            kettu.Logger.error('Failed to ensure DM channel:', error);
            throw new Error(`Could not create DM with user ${userId}: ${error.message}`);
        }
    }

    async normalizeTarget({ channelId, dmUserId }) {
        if (channelId) {
            return String(channelId);
        }
        
        if (dmUserId) {
            return await this.ensureDmChannel(String(dmUserId));
        }
        
        throw new Error('Either channelId or dmUserId must be provided');
    }

    async getUserInfo(userId, forceRefresh = false) {
        if (!userId || userId === "0") {
            return this.createDefaultUserInfo(userId);
        }
        
        // Check cache first (if enabled and not forcing refresh)
        if (this.config.features.enableCache && !forceRefresh && this.userInfoCache.has(userId)) {
            return this.userInfoCache.get(userId);
        }
        
        try {
            if (!this.modules.UserStore) {
                this.modules.UserStore = await this.waitForModule(['getUser']);
            }
            
            const userInfo = await this.modules.UserStore.getUser(userId);
            
            if (userInfo && userInfo.username) {
                const processedInfo = this.processUserInfo(userId, userInfo);
                
                // Cache the result
                if (this.config.features.enableCache) {
                    this.userInfoCache.set(userId, processedInfo);
                }
                
                return processedInfo;
            }
            
        } catch (error) {
            kettu.Logger.warn(`Could not fetch user info for ${userId}:`, error);
        }
        
        // Fallback to default user info
        const defaultInfo = this.createDefaultUserInfo(userId);
        
        if (this.config.features.enableCache) {
            this.userInfoCache.set(userId, defaultInfo);
        }
        
        return defaultInfo;
    }

    processUserInfo(userId, userInfo) {
        return {
            id: userId,
            username: userInfo.global_name || userInfo.username,
            discriminator: userInfo.discriminator || "0",
            avatar: userInfo.avatar ? 
                `https://cdn.discordapp.com/avatars/${userId}/${userInfo.avatar}.webp?size=256` :
                `https://cdn.discordapp.com/embed/avatars/${Number(userId) % 6}.png`,
            global_name: userInfo.global_name || userInfo.username,
            bot: userInfo.bot || false,
            system: userInfo.system || false,
            flags: userInfo.flags || 0,
            premium_type: userInfo.premium_type || 0,
            public_flags: userInfo.public_flags || 0
        };
    }

    createDefaultUserInfo(userId) {
        const fallbackIndex = Number(userId) % 6;
        return {
            id: userId,
            username: `User ${userId}`,
            discriminator: "0",
            avatar: `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`,
            global_name: `User ${userId}`,
            bot: false,
            system: false,
            flags: 0,
            premium_type: 0,
            public_flags: 0
        };
    }

    sanitizeImageUrl(url) {
        if (!url) return url;
        
        try {
            let sanitized = String(url);
            
            // Convert WebP to PNG for better compatibility
            sanitized = sanitized.replace(/(\?|&)format=webp\b/gi, "$1format=png");
            sanitized = sanitized.replace(/\bformat=webp\b/gi, "format=png");
            
            // Ensure HTTPS for Discord CDN
            if (sanitized.includes('cdn.discordapp.com') || sanitized.includes('media.discordapp.net')) {
                sanitized = sanitized.replace(/^http:/, 'https:');
            }
            
            return sanitized;
        } catch (error) {
            kettu.Logger.warn('Failed to sanitize image URL:', error);
            return url;
        }
    }

    validateMessageParams(params) {
        const errors = [];
        
        if (!params.dmUserId && !params.channelId) {
            errors.push('Either dmUserId or channelId must be provided');
        }
        
        if (!params.content && !params.embed) {
            errors.push('Either content or embed must be provided');
        }
        
        if (params.userId && !/^\d{17,20}$/.test(params.userId)) {
            errors.push('Invalid user ID format');
        }
        
        if (params.dmUserId && !/^\d{17,20}$/.test(params.dmUserId)) {
            errors.push('Invalid target user ID format');
        }
        
        if (params.channelId && !/^\d{17,20}$/.test(params.channelId)) {
            errors.push('Invalid channel ID format');
        }
        
        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join(', ')}`);
        }
        
        return true;
    }

    createEmbed(embedData) {
        if (!embedData || (!embedData.title && !embedData.description && !embedData.thumbnail && !embedData.image)) {
            return null;
        }
        
        const embed = {
            type: "rich",
            title: embedData.title || undefined,
            description: embedData.description || undefined,
            url: embedData.url || undefined,
            timestamp: embedData.timestamp || undefined,
            color: embedData.color || 0x5865F2, // Discord blurple
            footer: embedData.footer || undefined,
            image: undefined,
            thumbnail: undefined,
            author: embedData.author || undefined,
            fields: embedData.fields || undefined
        };
        
        // Handle thumbnail
        if (embedData.thumbnail) {
            const thumbUrl = typeof embedData.thumbnail === 'string' ? embedData.thumbnail : embedData.thumbnail.url;
            if (thumbUrl) {
                embed.thumbnail = {
                    url: this.sanitizeImageUrl(thumbUrl),
                    proxy_url: this.sanitizeImageUrl(thumbUrl),
                    width: 80,
                    height: 80
                };
            }
        }
        
        // Handle image
        if (embedData.image) {
            const imageUrl = typeof embedData.image === 'string' ? embedData.image : embedData.image.url;
            if (imageUrl) {
                embed.image = {
                    url: this.sanitizeImageUrl(imageUrl),
                    proxy_url: this.sanitizeImageUrl(imageUrl),
                    width: 400,
                    height: 300
                };
            }
        }
        
        // Clean up undefined properties
        Object.keys(embed).forEach(key => {
            if (embed[key] === undefined) {
                delete embed[key];
            }
        });
        
        return Object.keys(embed).length > 0 ? embed : null;
    }

    generateMessageId() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        return `injected_${timestamp}_${random}`;
    }

    // =============================================
    // MAIN MESSAGE FUNCTIONS
    // =============================================

    async fakeMessage(params) {
        try {
            // Validate parameters
            this.validateMessageParams(params);
            
            const {
                channelId,
                dmUserId,
                userId = "0",
                content = "",
                embed,
                username,
                avatar,
                timestamp = new Date().toISOString()
            } = params;
            
            // Normalize target channel
            const target = await this.normalizeTarget({ channelId, dmUserId });
            
            // Get or create user info
            let userInfo;
            let finalUsername = username;
            let finalAvatar = avatar;
            
            if (userId && userId !== "0") {
                userInfo = await this.getUserInfo(userId);
                finalUsername = finalUsername || userInfo.username;
                finalAvatar = finalAvatar || userInfo.avatar;
            } else {
                userInfo = this.createDefaultUserInfo(userId);
                finalUsername = finalUsername || "System";
            }
            
            // Create message object
            const message = {
                id: this.generateMessageId(),
                type: 0,
                content: String(content),
                channel_id: target,
                author: {
                    id: userId,
                    username: finalUsername,
                    discriminator: userInfo.discriminator,
                    avatar: finalAvatar,
                    global_name: finalUsername,
                    bot: userInfo.bot,
                    avatar_decoration: null,
                    display_name: finalUsername,
                    public_flags: userInfo.public_flags
                },
                attachments: [],
                embeds: [],
                mentions: [],
                mention_roles: [],
                pinned: false,
                mention_everyone: false,
                tts: false,
                timestamp: timestamp,
                edited_timestamp: null,
                flags: 0,
                components: [],
                referenced_message: null,
                // Custom flags
                isFakeMessage: true,
                fromMessageInjector: true,
                injectorVersion: this.version
            };
            
            // Add embed if provided
            const createdEmbed = this.createEmbed(embed);
            if (createdEmbed) {
                message.embeds = [createdEmbed];
            }
            
            // Dispatch message
            await this.dispatchMessage(message, target);
            
            kettu.Logger.debug(`Fake message injected to ${target}`);
            return message;
            
        } catch (error) {
            kettu.Logger.error('Failed to inject fake message:', error);
            throw error;
        }
    }

    async sendMessage(params) {
        try {
            this.validateMessageParams(params);
            
            const {
                channelId,
                dmUserId,
                content = "",
                embed
            } = params;
            
            if (!this.modules.MessageActions) {
                this.modules.MessageActions = await this.waitForModule(['sendMessage']);
            }
            
            const target = await this.normalizeTarget({ channelId, dmUserId });
            
            const message = {
                content: String(content),
                invalidEmojis: [],
                tts: false,
                allowed_mentions: {
                    parse: ["users", "roles", "everyone"],
                    replied_user: true
                },
                message_reference: null,
                attachments: [],
                flags: 0
            };
            
            // Add embed if provided
            const createdEmbed = this.createEmbed(embed);
            if (createdEmbed) {
                message.embed = createdEmbed;
            }
            
            await this.modules.MessageActions.sendMessage(target, message);
            
            kettu.Logger.debug(`Real message sent to ${target}`);
            return { success: true, channelId: target };
            
        } catch (error) {
            kettu.Logger.error('Failed to send message:', error);
            throw error;
        }
    }

    async dispatchMessage(message, channelId) {
        try {
            // Try MessageActions first
            if (this.modules.MessageActions?.receiveMessage) {
                this.modules.MessageActions.receiveMessage(channelId, message);
                return;
            }
            
            // Fallback to FluxDispatcher
            if (this.modules.FluxDispatcher?.dispatch) {
                this.modules.FluxDispatcher.dispatch({
                    type: "MESSAGE_CREATE",
                    message: message,
                    channelId: channelId,
                    isPushNotification: false
                });
                return;
            }
            
            throw new Error('No available method to dispatch message');
            
        } catch (error) {
            kettu.Logger.error('Failed to dispatch message:', error);
            throw error;
        }
    }

    // =============================================
    // USER INTERFACE
    // =============================================

    createInjectorUI() {
        // Remove existing modal if present
        this.cleanupUI();
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'message-injector-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            z-index: 9998;
            display: none;
            backdrop-filter: blur(2px);
        `;
        overlay.onclick = () => this.closeInjector();
        
        // Create modal
        this.injectorModal = document.createElement('div');
        this.injectorModal.className = 'message-injector-modal';
        this.injectorModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 95%;
            max-width: 500px;
            max-height: 85vh;
            background: var(--background-primary);
            border: 1px solid var(--background-tertiary);
            border-radius: 12px;
            z-index: 9999;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            font-family: var(--font-primary);
            color: var(--text-normal);
            overflow: hidden;
            display: none;
            animation: injectorSlideIn 0.2s ease-out;
        `;
        
        // Add CSS animation
        this.injectorModal.innerHTML = `
            <style>
                @keyframes injectorSlideIn {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -60%);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%);
                    }
                }
                
                .message-injector-input {
                    transition: border-color 0.2s ease;
                }
                
                .message-injector-input:focus {
                    border-color: var(--brand-experiment) !important;
                }
            </style>
        `;
        
        // Build modal structure
        this.buildModalContent();
        
        // Add to document
        document.body.appendChild(overlay);
        document.body.appendChild(this.injectorModal);
        
        kettu.Logger.debug('Injector UI created');
    }

    buildModalContent() {
        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px;
            background: var(--background-secondary);
            border-bottom: 1px solid var(--background-tertiary);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const title = document.createElement('div');
        title.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        
        const icon = document.createElement('div');
        icon.textContent = '💬';
        icon.style.fontSize = '20px';
        
        const titleText = document.createElement('h2');
        titleText.textContent = 'Message Injector';
        titleText.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 700;
            color: var(--text-normal);
        `;
        
        title.appendChild(icon);
        title.appendChild(titleText);
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 24px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s ease;
        `;
        closeBtn.onmouseover = () => closeBtn.style.color = 'var(--text-normal)';
        closeBtn.onmouseout = () => closeBtn.style.color = 'var(--text-muted)';
        closeBtn.onclick = () => this.closeInjector();
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        
        // Content
        const content = document.createElement('div');
        content.style.cssText = `
            padding: 20px;
            overflow-y: auto;
            max-height: calc(85vh - 140px);
        `;
        
        // Form sections
        const sections = [
            this.createTargetSection(),
            this.createSenderSection(),
            this.createMessageSection(),
            this.createEmbedSection(),
            this.createActionSection()
        ];
        
        sections.forEach(section => content.appendChild(section));
        
        // Append to modal
        this.injectorModal.appendChild(header);
        this.injectorModal.appendChild(content);
    }

    createTargetSection() {
        const section = document.createElement('div');
        section.style.marginBottom = '24px';
        
        const label = document.createElement('label');
        label.textContent = 'Target User ID *';
        label.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-normal);
        `;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '123456789012345678';
        input.value = this.config.defaults.targetUserId;
        input.style.cssText = `
            width: 100%;
            padding: 12px;
            background: var(--background-secondary);
            border: 1px solid var(--background-tertiary);
            border-radius: 6px;
            color: var(--text-normal);
            font-size: 14px;
            box-sizing: border-box;
            transition: border-color 0.2s ease;
        `;
        input.className = 'message-injector-input';
        
        const help = document.createElement('div');
        help.textContent = 'The user whose DMs will receive the message';
        help.style.cssText = `
            margin-top: 4px;
            font-size: 12px;
            color: var(--text-muted);
        `;
        
        section.appendChild(label);
        section.appendChild(input);
        section.appendChild(help);
        
        // Store reference
        this.targetInput = input;
        
        return section;
    }

    createSenderSection() {
        const section = document.createElement('div');
        section.style.marginBottom = '24px';
        
        const label = document.createElement('label');
        label.textContent = 'Sender User ID *';
        label.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-normal);
        `;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '987654321098765432';
        input.value = this.config.defaults.senderUserId;
        input.style.cssText = `
            width: 100%;
            padding: 12px;
            background: var(--background-secondary);
            border: 1px solid var(--background-tertiary);
            border-radius: 6px;
            color: var(--text-normal);
            font-size: 14px;
            box-sizing: border-box;
            transition: border-color 0.2s ease;
        `;
        input.className = 'message-injector-input';
        
        const help = document.createElement('div');
        help.textContent = 'The user who the message appears to be from';
        help.style.cssText = `
            margin-top: 4px;
            font-size: 12px;
            color: var(--text-muted);
        `;
        
        section.appendChild(label);
        section.appendChild(input);
        section.appendChild(help);
        
        // Store reference
        this.senderInput = input;
        
        return section;
    }

    createMessageSection() {
        const section = document.createElement('div');
        section.style.marginBottom = '24px';
        
        const label = document.createElement('label');
        label.textContent = 'Message Content';
        label.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-normal);
        `;
        
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Enter your message here...';
        textarea.value = this.config.defaults.messageContent;
        textarea.rows = 4;
        textarea.style.cssText = `
            width: 100%;
            padding: 12px;
            background: var(--background-secondary);
            border: 1px solid var(--background-tertiary);
            border-radius: 6px;
            color: var(--text-normal);
            font-size: 14px;
            resize: vertical;
            box-sizing: border-box;
            font-family: inherit;
            transition: border-color 0.2s ease;
        `;
        textarea.className = 'message-injector-input';
        
        section.appendChild(label);
        section.appendChild(textarea);
        
        // Store reference
        this.messageInput = textarea;
        
        return section;
    }

    createEmbedSection() {
        const section = document.createElement('div');
        section.style.marginBottom = '24px';
        
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
        `;
        
        const icon = document.createElement('div');
        icon.textContent = '🖼️';
        
        const title = document.createElement('h3');
        title.textContent = 'Rich Embed (Optional)';
        title.style.cssText = `
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-normal);
        `;
        
        header.appendChild(icon);
        header.appendChild(title);
        
        // Embed Title
        const titleGroup = document.createElement('div');
        titleGroup.style.marginBottom = '16px';
        
        const titleLabel = document.createElement('label');
        titleLabel.textContent = 'Embed Title';
        titleLabel.style.cssText = `
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-normal);
        `;
        
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.placeholder = 'Embed title...';
        titleInput.value = this.config.defaults.embedTitle;
        titleInput.style.cssText = `
            width: 100%;
            padding: 10px;
            background: var(--background-secondary);
            border: 1px solid var(--background-tertiary);
            border-radius: 4px;
            color: var(--text-normal);
            font-size: 13px;
            box-sizing: border-box;
        `;
        titleInput.className = 'message-injector-input';
        
        titleGroup.appendChild(titleLabel);
        titleGroup.appendChild(titleInput);
        
        // Embed Description
        const descGroup = document.createElement('div');
        descGroup.style.marginBottom = '16px';
        
        const descLabel = document.createElement('label');
        descLabel.textContent = 'Embed Description';
        descLabel.style.cssText = `
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-normal);
        `;
        
        const descInput = document.createElement('textarea');
        descInput.placeholder = 'Embed description...';
        descInput.value = this.config.defaults.embedDescription;
        descInput.rows = 3;
        descInput.style.cssText = `
            width: 100%;
            padding: 10px;
            background: var(--background-secondary);
            border: 1px solid var(--background-tertiary);
            border-radius: 4px;
            color: var(--text-normal);
            font-size: 13px;
            resize: vertical;
            box-sizing: border-box;
            font-family: inherit;
        `;
        descInput.className = 'message-injector-input';
        
        descGroup.appendChild(descLabel);
        descGroup.appendChild(descInput);
        
        // Embed Image URL
        const imageGroup = document.createElement('div');
        
        const imageLabel = document.createElement('label');
        imageLabel.textContent = 'Embed Image URL';
        imageLabel.style.cssText = `
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-normal);
        `;
        
        const imageInput = document.createElement('input');
        imageInput.type = 'text';
        imageInput.placeholder = 'https://example.com/image.png';
        imageInput.value = this.config.defaults.embedImageUrl;
        imageInput.style.cssText = `
            width: 100%;
            padding: 10px;
            background: var(--background-secondary);
            border: 1px solid var(--background-tertiary);
            border-radius: 4px;
            color: var(--text-normal);
            font-size: 13px;
            box-sizing: border-box;
        `;
        imageInput.className = 'message-injector-input';
        
        imageGroup.appendChild(imageLabel);
        imageGroup.appendChild(imageInput);
        
        section.appendChild(header);
        section.appendChild(titleGroup);
        section.appendChild(descGroup);
        section.appendChild(imageGroup);
        
        // Store references
        this.embedTitleInput = titleInput;
        this.embedDescInput = descInput;
        this.embedImageInput = imageInput;
        
        return section;
    }

    createActionSection() {
        const section = document.createElement('div');
        
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = `
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            flex-wrap: wrap;
        `;
        
        // Cancel Button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            padding: 12px 24px;
            background: transparent;
            border: 1px solid var(--background-tertiary);
            border-radius: 6px;
            color: var(--text-normal);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        cancelBtn.onmouseover = () => cancelBtn.style.backgroundColor = 'var(--background-modifier-hover)';
        cancelBtn.onmouseout = () => cancelBtn.style.backgroundColor = 'transparent';
        cancelBtn.onclick = () => this.closeInjector();
        
        // Send Button (Real Message)
        const sendBtn = document.createElement('button');
        sendBtn.textContent = 'Send Message';
        sendBtn.style.cssText = `
            padding: 12px 24px;
            background: var(--background-secondary);
            border: 1px solid var(--background-tertiary);
            border-radius: 6px;
            color: var(--text-normal);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        sendBtn.onmouseover = () => sendBtn.style.backgroundColor = 'var(--background-modifier-hover)';
        sendBtn.onmouseout = () => sendBtn.style.backgroundColor = 'var(--background-secondary)';
        sendBtn.onclick = () => this.sendMessageFromUI();
        
        // Inject Button (Fake Message)
        const injectBtn = document.createElement('button');
        injectBtn.textContent = 'Inject Message';
        injectBtn.style.cssText = `
            padding: 12px 24px;
            background: var(--brand-experiment);
            border: none;
            border-radius: 6px;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s ease;
        `;
        injectBtn.onmouseover = () => injectBtn.style.backgroundColor = 'var(--brand-experiment-560)';
        injectBtn.onmouseout = () => injectBtn.style.backgroundColor = 'var(--brand-experiment)';
        injectBtn.onclick = () => this.injectMessageFromUI();
        
        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(sendBtn);
        buttonGroup.appendChild(injectBtn);
        
        section.appendChild(buttonGroup);
        
        return section;
    }

    addInjectorButton() {
        // Wait for Discord to load
        const maxAttempts = 30;
        let attempts = 0;
        
        const tryAddButton = () => {
            attempts++;
            
            const possibleLocations = [
                document.querySelector('[class*="toolbar"]'),
                document.querySelector('[class*="chat"] [class*="header"]'),
                document.querySelector('[class*="titleWrapper"]'),
                document.querySelector('[class*="container"] [class*="header"]')
            ];
            
            const location = possibleLocations.find(loc => loc !== null);
            
            if (location) {
                this.createInjectorButton(location);
                kettu.Logger.debug('Injector button added to UI');
                return;
            }
            
            if (attempts < maxAttempts) {
                setTimeout(tryAddButton, 500);
            } else {
                this.createFloatingButton();
                kettu.Logger.debug('Floating injector button created');
            }
        };
        
        tryAddButton();
    }

    createInjectorButton(parent) {
        // Remove existing button
        const existingBtn = document.querySelector('.message-injector-btn');
        if (existingBtn) {
            existingBtn.remove();
        }
        
        const button = document.createElement('div');
        button.className = 'message-injector-btn';
        button.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px;">
                <span>💬</span>
                <span>Inject</span>
            </div>
        `;
        button.style.cssText = `
            padding: 8px 12px;
            background: var(--brand-experiment);
            color: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            margin: 0 8px;
            user-select: none;
            transition: all 0.2s ease;
        `;
        button.onmouseover = () => {
            button.style.backgroundColor = 'var(--brand-experiment-560)';
            button.style.transform = 'translateY(-1px)';
        };
        button.onmouseout = () => {
            button.style.backgroundColor = 'var(--brand-experiment)';
            button.style.transform = 'translateY(0)';
        };
        button.onclick = () => this.openInjector();
        
        parent.appendChild(button);
        this.injectorButton = button;
    }

    createFloatingButton() {
        const button = document.createElement('div');
        button.className = 'message-injector-floating-btn';
        button.innerHTML = '💬';
        button.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            width: 50px;
            height: 50px;
            background: var(--brand-experiment);
            color: white;
            border-radius: 50%;
            cursor: pointer;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9997;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            user-select: none;
            transition: all 0.3s ease;
        `;
        button.onmouseover = () => {
            button.style.backgroundColor = 'var(--brand-experiment-560)';
            button.style.transform = 'scale(1.1)';
        };
        button.onmouseout = () => {
            button.style.backgroundColor = 'var(--brand-experiment)';
            button.style.transform = 'scale(1)';
        };
        button.onclick = () => this.openInjector();
        
        document.body.appendChild(button);
        this.floatingButton = button;
    }

    // =============================================
    // UI EVENT HANDLERS
    // =============================================

    openInjector() {
        if (!this.injectorModal) {
            this.createInjectorUI();
        }
        
        const overlay = document.querySelector('.message-injector-overlay');
        if (overlay) overlay.style.display = 'block';
        
        this.injectorModal.style.display = 'block';
        this.isModalOpen = true;
        
        // Focus first input
        setTimeout(() => {
            if (this.targetInput) this.targetInput.focus();
        }, 100);
        
        kettu.Logger.debug('Injector UI opened');
    }

    closeInjector() {
        const overlay = document.querySelector('.message-injector-overlay');
        if (overlay) overlay.style.display = 'none';
        
        if (this.injectorModal) {
            this.injectorModal.style.display = 'none';
        }
        
        this.isModalOpen = false;
        kettu.Logger.debug('Injector UI closed');
    }

    toggleInjector() {
        if (this.isModalOpen) {
            this.closeInjector();
        } else {
            this.openInjector();
        }
    }

    getUIInputValues() {
        return {
            targetUserId: this.targetInput?.value.trim() || '',
            senderUserId: this.senderInput?.value.trim() || '',
            messageContent: this.messageInput?.value.trim() || '',
            embedTitle: this.embedTitleInput?.value.trim() || '',
            embedDescription: this.embedDescInput?.value.trim() || '',
            embedImageUrl: this.embedImageInput?.value.trim() || ''
        };
    }

    async injectMessageFromUI() {
        const values = this.getUIInputValues();
        
        // Validate required fields
        if (!values.targetUserId) {
            this.showNotification('Please enter a Target User ID', 'error');
            return;
        }
        
        if (!values.senderUserId) {
            this.showNotification('Please enter a Sender User ID', 'error');
            return;
        }
        
        if (!values.messageContent && !values.embedTitle && !values.embedDescription) {
            this.showNotification('Please enter either message content or embed information', 'error');
            return;
        }
        
        try {
            // Prepare embed data
            const embedData = {};
            if (values.embedTitle) embedData.title = values.embedTitle;
            if (values.embedDescription) embedData.description = values.embedDescription;
            if (values.embedImageUrl) {
                embedData.thumbnail = values.embedImageUrl;
                embedData.image = values.embedImageUrl;
            }
            
            // Inject the message
            await this.fakeMessage({
                dmUserId: values.targetUserId,
                userId: values.senderUserId,
                content: values.messageContent,
                embed: Object.keys(embedData).length > 0 ? embedData : undefined
            });
            
            this.showNotification('Message injected successfully!', 'success');
            this.closeInjector();
            
            // Save as defaults
            this.config.defaults = { ...this.config.defaults, ...values };
            this.saveConfig();
            
        } catch (error) {
            this.showNotification(`Failed to inject message: ${error.message}`, 'error');
            kettu.Logger.error('UI injection failed:', error);
        }
    }

    async sendMessageFromUI() {
        const values = this.getUIInputValues();
        
        // Validate required fields
        if (!values.targetUserId) {
            this.showNotification('Please enter a Target User ID', 'error');
            return;
        }
        
        if (!values.messageContent && !values.embedTitle && !values.embedDescription) {
            this.showNotification('Please enter either message content or embed information', 'error');
            return;
        }
        
        try {
            // Prepare embed data
            const embedData = {};
            if (values.embedTitle) embedData.title = values.embedTitle;
            if (values.embedDescription) embedData.description = values.embedDescription;
            if (values.embedImageUrl) {
                embedData.thumbnail = values.embedImageUrl;
                embedData.image = values.embedImageUrl;
            }
            
            // Send the message
            await this.sendMessage({
                dmUserId: values.targetUserId,
                content: values.messageContent,
                embed: Object.keys(embedData).length > 0 ? embedData : undefined
            });
            
            this.showNotification('Message sent successfully!', 'success');
            this.closeInjector();
            
            // Save as defaults (except sender)
            const { senderUserId, ...defaults } = values;
            this.config.defaults = { ...this.config.defaults, ...defaults };
            this.saveConfig();
            
        } catch (error) {
            this.showNotification(`Failed to send message: ${error.message}`, 'error');
            kettu.Logger.error('UI send failed:', error);
        }
    }

    // =============================================
    // UTILITY FUNCTIONS
    // =============================================

    showNotification(message, type = 'info') {
        if (!this.config.features.showNotifications) return;
        
        try {
            // Use Kettu's notification system
            if (kettu.API && kettu.API.showToast) {
                kettu.API.showToast(message, type);
                return;
            }
            
            // Fallback to custom notification
            const notification = document.createElement('div');
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                background: ${this.getNotificationColor(type)};
                color: white;
                border-radius: 8px;
                z-index: 10000;
                font-size: 14px;
                font-weight: 500;
                max-width: 300px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
                animation: notificationSlideIn 0.3s ease-out;
            `;
            
            // Add animation
            notification.innerHTML += `
                <style>
                    @keyframes notificationSlideIn {
                        from {
                            opacity: 0;
                            transform: translateX(100%);
                        }
                        to {
                            opacity: 1;
                            transform: translateX(0);
                        }
                    }
                </style>
            `;
            
            document.body.appendChild(notification);
            
            // Auto-remove after 3 seconds
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    notification.style.animation = 'notificationSlideOut 0.3s ease-in';
                    setTimeout(() => {
                        if (document.body.contains(notification)) {
                            document.body.removeChild(notification);
                        }
                    }, 300);
                }
            }, 3000);
            
        } catch (error) {
            kettu.Logger.warn('Failed to show notification:', error);
        }
    }

    getNotificationColor(type) {
        const colors = {
            success: 'var(--text-positive)',
            error: 'var(--text-danger)',
            warning: 'var(--text-warning)',
            info: 'var(--brand-experiment)'
        };
        return colors[type] || colors.info;
    }

    cleanupUI() {
        // Remove modal
        if (this.injectorModal && document.body.contains(this.injectorModal)) {
            document.body.removeChild(this.injectorModal);
            this.injectorModal = null;
        }
        
        // Remove overlay
        const overlay = document.querySelector('.message-injector-overlay');
        if (overlay && document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
        
        // Remove buttons
        const buttons = document.querySelectorAll('.message-injector-btn, .message-injector-floating-btn');
        buttons.forEach(btn => {
            if (document.body.contains(btn)) {
                document.body.removeChild(btn);
            }
        });
        
        this.injectorButton = null;
        this.floatingButton = null;
    }

    // =============================================
    // PUBLIC API
    // =============================================

    get api() {
        return {
            // Core message functions
            injectMessage: (params) => this.fakeMessage(params),
            sendMessage: (params) => this.sendMessage(params),
            fakeMessage: (params) => this.fakeMessage(params),
            
            // User management
            getUserInfo: (userId, forceRefresh) => this.getUserInfo(userId, forceRefresh),
            clearUserCache: () => {
                this.userInfoCache.clear();
                kettu.Logger.debug('User cache cleared');
            },
            
            // UI controls
            openUI: () => this.openInjector(),
            closeUI: () => this.closeInjector(),
            toggleUI: () => this.toggleInjector(),
            
            // Configuration
            getConfig: () => ({ ...this.config }),
            updateConfig: (newConfig) => {
                this.config = { ...this.config, ...newConfig };
                this.saveConfig();
                kettu.Logger.debug('Configuration updated');
            },
            resetConfig: () => {
                this.config = {
                    features: {
                        autoOpenUI: true,
                        showNotifications: true,
                        enableCache: true
                    },
                    defaults: {
                        targetUserId: "",
                        senderUserId: "", 
                        messageContent: "",
                        embedTitle: "",
                        embedDescription: "",
                        embedImageUrl: ""
                    },
                    ui: {
                        position: "floating",
                        theme: "discord"
                    }
                };
                this.saveConfig();
                kettu.Logger.debug('Configuration reset to defaults');
            },
            
            // Utility functions
            getCacheSize: () => this.userInfoCache.size,
            getPluginInfo: () => ({
                name: this.name,
                version: this.version,
                author: this.author,
                initialized: this.initialized
            }),
            
            // Test functions
            test: async (targetUserId = '123456789012345678', senderUserId = '987654321098765432') => {
                try {
                    const result = await this.fakeMessage({
                        dmUserId: targetUserId,
                        userId: senderUserId,
                        content: '🧪 Test message from Message Injector!',
                        embed: {
                            title: 'Test Embed',
                            description: 'This is a test embed from the Message Injector plugin.',
                            color: 0x00ff00
                        }
                    });
                    this.showNotification('Test message injected successfully!', 'success');
                    return result;
                } catch (error) {
                    this.showNotification(`Test failed: ${error.message}`, 'error');
                    throw error;
                }
            },
            
            quickInject: (targetUserId, senderUserId, content) => {
                return this.fakeMessage({
                    dmUserId: targetUserId,
                    userId: senderUserId,
                    content: content || 'Quick injected message!',
                    timestamp: new Date().toISOString()
                });
            }
        };
    }
};

// Export the plugin class
typeof module !== 'undefined' && (module.exports = Plugin);